import { api, ApiError } from "./api";
import { avatarSignals } from "./avatarSignals";
import type { Plan } from "./types";

/**
 * Hands-free voice conversation engine (ChatGPT-voice style).
 *
 * Mic -> AudioWorklet frames (20 ms) -> energy VAD -> 16 kHz mono WAV of *only the spoken part* -> POST /api/voice/turn
 * (speech-to-text, plan/approval, text-to-speech in one request) -> play the reply -> listen again.
 * Barge-in: speaking over Munshi stops playback and starts a new utterance. Silence is never uploaded (speech credits are metered).
 */

export type VoiceState = "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "error";

export interface TurnResult {
  empty: boolean;
  transcript: string;
  reply?: string;
  decision?: "approved" | "rejected" | null;
  plan?: Plan | null;
  audio?: string | null;
  audio_mime?: string;
  providers?: { stt: string; tts: string | null };
  timings?: { stt_ms: number; think_ms?: number; tts_ms?: number };
}

export interface VoiceHandlers {
  onState: (s: VoiceState) => void;
  onLevel: (level: number) => void; // 0..1, for the orb
  onTurn: (r: TurnResult) => void;
  onError: (msg: string) => void;
  onIdle: () => void; // nothing said for IDLE_MS: the UI ends the session (saves credits)
}

const TARGET_RATE = 16000;
const FRAME_MS = 20;
const PREROLL_FRAMES = 20; //          400 ms kept before speech onset so first words are not clipped
const START_FRAMES = 8; //             160 ms of speech to start an utterance
const BARGE_IN_FRAMES = 18; //         360 ms (and a higher threshold) to interrupt Munshi while it is speaking
const HANGOVER_FRAMES = 45; //         900 ms of silence ends the utterance
const MAX_UTTERANCE_FRAMES = 1250; //  25 s (Sarvam REST limit is 30 s)
const MIN_VOICED_FRAMES = 15; //       <300 ms of speech is a click/cough: discard
const MIN_RMS = 0.012;
const IDLE_MS = 60_000;
const MAX_TURNS = 40;

const WORKLET = `
class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.n = Math.round(sampleRate * ${FRAME_MS} / 1000); this.buf = new Float32Array(this.n); this.i = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      this.buf[this.i++] = ch[k];
      if (this.i === this.n) { this.port.postMessage(this.buf.slice()); this.i = 0; }
    }
    return true;
  }
}
registerProcessor("cap", Cap);
`;

export function encodeWav(samples: Int16Array, rate = TARGET_RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  new Int16Array(buf, 44).set(samples);
  return new Blob([buf], { type: "audio/wav" });
}

function toPcm16(f: Float32Array, ratio: number): Int16Array {
  const n = Math.floor(f.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * ratio);
    const e = Math.min(f.length, Math.max(s + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = s; j < e; j++) sum += f[j];
    const x = Math.max(-1, Math.min(1, sum / (e - s)));
    out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  return out;
}

export class VoiceSession {
  private h: VoiceHandlers;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private audio: HTMLAudioElement | null = null;
  private state: VoiceState = "connecting";
  private muted = false;
  private hasMic = false;
  private playCtx?: AudioContext; //   playback-only context when there is no mic
  private lipRaf = 0;
  private closed = false;
  private turns = 0;

  private noise = 0.004;
  private ring: Int16Array[] = [];
  private utter: Int16Array[] = [];
  private capturing = false;
  private run = 0;
  private silence = 0;
  private voiced = 0;
  private lastActivity = Date.now();
  private idleTimer?: ReturnType<typeof setInterval>;

  constructor(handlers: VoiceHandlers) { this.h = handlers; }

  private set(s: VoiceState) {
    if (this.state === s) return;
    this.state = s;
    this.h.onState(s);
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Is browser mein mic support nahi hai.");
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (this.closed) { this.stream.getTracks().forEach((t) => t.stop()); return; }
    this.ctx = new AudioContext();
    await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "cap", { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onFrame(e.data);
    src.connect(this.node);
    this.hasMic = true;
    this.lastActivity = Date.now();
    this.idleTimer = setInterval(() => {
      if (this.state === "listening" && Date.now() - this.lastActivity > IDLE_MS) this.h.onIdle();
    }, 1000);
    // The mic can finish opening *after* a first typed message was already sent (dashboard shortcuts): never overwrite thinking / speaking.
    if (this.state === "connecting") this.set("listening");
  }

  /** The state to rest in between turns: listening if the mic is live, otherwise the error state (typed messages still work). */
  private rest(): VoiceState { return this.hasMic ? "listening" : "error"; }

  /** Send a typed message through the same turn pipeline (no speech-to-text). */
  async sendText(text: string) {
    const t = text.trim();
    if (!t || this.state === "thinking" || this.closed) return;
    this.stopPlayback();
    const form = new FormData();
    form.append("text", t);
    await this.submit(form);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) { this.capturing = false; this.utter = []; this.run = 0; if (this.state === "hearing") this.set("listening"); }
    this.lastActivity = Date.now();
  }

  /** Stop talking and listen again (tap on the orb). */
  interrupt() {
    this.stopPlayback();
    if (this.state === "speaking") this.set(this.rest());
  }

  /** Speak arbitrary text (e.g. the result of a button approval). */
  async say(text: string) {
    try {
      const blob = await api.blob("/tts/speak", { text });
      const url = URL.createObjectURL(blob);
      await this.play(url, () => URL.revokeObjectURL(url));
    } catch { /* speech is a bonus; the text is already on screen */ }
  }

  stop() {
    this.closed = true;
    clearInterval(this.idleTimer);
    this.stopPlayback();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    void this.playCtx?.close().catch(() => {});
  }

  // --- audio frames / VAD -------------------------------------------------------------------------------------
  private onFrame(f: Float32Array) {
    if (this.closed) return;
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    this.h.onLevel(Math.min(1, rms * 9));
    if (this.muted || this.state === "thinking" || this.state === "connecting" || this.state === "error") return;

    const speakingNow = this.state === "speaking";
    const threshold = Math.max(MIN_RMS, this.noise * 3.2) * (speakingNow ? 2.2 : 1);
    const isSpeech = rms > threshold;
    if (!isSpeech && !this.capturing) this.noise = Math.max(0.002, this.noise * 0.95 + rms * 0.05);

    const pcm = toPcm16(f, this.ctx!.sampleRate / TARGET_RATE);

    if (!this.capturing) {
      this.ring.push(pcm);
      if (this.ring.length > PREROLL_FRAMES) this.ring.shift();
      this.run = isSpeech ? this.run + 1 : Math.max(0, this.run - 1);
      if (this.run >= (speakingNow ? BARGE_IN_FRAMES : START_FRAMES)) {
        if (speakingNow) this.stopPlayback(); // barge-in
        this.capturing = true;
        this.utter = [...this.ring];
        this.voiced = this.run;
        this.silence = 0;
        this.lastActivity = Date.now();
        this.set("hearing");
      }
      return;
    }

    this.utter.push(pcm);
    if (isSpeech) { this.voiced++; this.silence = 0; this.lastActivity = Date.now(); } else this.silence++;
    if (this.silence >= HANGOVER_FRAMES || this.utter.length >= MAX_UTTERANCE_FRAMES) this.finishUtterance();
  }

  private finishUtterance() {
    const frames = this.utter, voiced = this.voiced;
    this.capturing = false; this.utter = []; this.ring = []; this.run = 0; this.silence = 0; this.voiced = 0;
    if (voiced < MIN_VOICED_FRAMES) { this.set("listening"); return; } // noise burst
    const trimmed = frames.slice(0, Math.max(1, frames.length - (HANGOVER_FRAMES - 15))); // keep ~300 ms of trailing silence
    const total = trimmed.reduce((n, a) => n + a.length, 0);
    const pcm = new Int16Array(total);
    let o = 0;
    for (const a of trimmed) { pcm.set(a, o); o += a.length; }
    void this.sendTurn(pcm, total / TARGET_RATE);
  }

  // --- server round trip ------------------------------------------------------------------------------------
  private async sendTurn(pcm: Int16Array, seconds: number) {
    const form = new FormData();
    form.append("audio", encodeWav(pcm), "voice.wav");
    form.append("duration", seconds.toFixed(2));
    await this.submit(form);
  }

  private async submit(form: FormData) {
    this.set("thinking");
    this.turns++;
    try {
      const res = await api.form<TurnResult>("/voice/turn", form);
      if (this.closed) return;
      this.h.onTurn(res);
      this.lastActivity = Date.now();
      if (this.turns >= MAX_TURNS) { this.h.onIdle(); return; }
      if (res.audio) {
        const url = `data:${res.audio_mime || "audio/mpeg"};base64,${res.audio}`;
        await this.play(url);
      } else this.set(this.rest());
    } catch (e) {
      if (this.closed) return;
      this.h.onError(e instanceof ApiError && e.status === 429 ? `Munshi abhi busy hai, ${e.retryAfter ?? 20}s baad dobara boliye.` : (e as Error).message);
      this.set(this.rest());
    }
  }

  private play(url: string, cleanup?: () => void): Promise<void> {
    this.stopPlayback();
    const a = new Audio(url);
    this.audio = a;
    this.lipSync(a);
    this.set("speaking");
    return new Promise<void>((resolve) => {
      const done = () => {
        this.endLipSync();
        cleanup?.();
        if (this.audio === a) { this.audio = null; if (!this.closed && this.state === "speaking") { this.lastActivity = Date.now(); this.set(this.rest()); } }
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      a.play().catch(done); // autoplay blocked: the text reply is still on screen
    });
  }

  /** Analyse the reply audio as it plays so the avatar's mouth follows the real sound (loudness -> opening, spectrum -> rounding / spreading). */
  private lipSync(a: HTMLAudioElement) {
    try {
      const ctx = this.ctx ?? (this.playCtx ??= new AudioContext());
      void ctx.resume();
      const src = ctx.createMediaElementSource(a);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.4;
      src.connect(an);
      an.connect(ctx.destination);
      const time = new Float32Array(an.fftSize);
      const freq = new Uint8Array(an.frequencyBinCount);
      const hz = ctx.sampleRate / an.fftSize;
      const clamp = (x: number) => Math.max(0, Math.min(1, x));
      let env = 0;
      avatarSignals.live = true;
      const tick = () => {
        if (this.audio !== a || this.closed) { this.endLipSync(); return; }
        an.getFloatTimeDomainData(time);
        let s = 0;
        for (let i = 0; i < time.length; i++) s += time[i] * time[i];
        const rms = Math.sqrt(s / time.length);
        an.getByteFrequencyData(freq);
        let lo = 0, mid = 0, hi = 0;
        for (let i = 1; i < freq.length; i++) {
          const f = i * hz;
          if (f < 600) lo += freq[i]; else if (f < 2500) mid += freq[i]; else if (f < 6000) hi += freq[i]; else break;
        }
        const tot = lo + mid + hi + 1;
        const target = clamp(Math.sqrt(Math.max(0, rms - 0.008)) * 3.2);
        env += (target - env) * (target > env ? 0.55 : 0.22); // fast attack, slower release: reads like a jaw
        avatarSignals.mouth = env;
        avatarSignals.round = clamp((lo / tot - 0.33) * 2.6);
        avatarSignals.wide = clamp((hi / tot - 0.1) * 5);
        this.lipRaf = requestAnimationFrame(tick);
      };
      this.lipRaf = requestAnimationFrame(tick);
    } catch { avatarSignals.live = false; } // the avatar falls back to a synthetic talking motion
  }

  private endLipSync() {
    cancelAnimationFrame(this.lipRaf);
    avatarSignals.mouth = 0; avatarSignals.round = 0; avatarSignals.wide = 0; avatarSignals.live = false;
  }

  private stopPlayback() {
    this.endLipSync();
    const a = this.audio;
    this.audio = null;
    if (a) { a.onended = null; a.onerror = null; a.pause(); }
  }
}
