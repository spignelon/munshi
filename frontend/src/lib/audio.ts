import { api } from "./api";

/** Records microphone audio as webm/opus (or whatever the browser supports). */
export class Recorder {
  private rec?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;

  static supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec!;
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
  }

  cancel() {
    try { this.rec?.stop(); } catch { /* already stopped */ }
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

let current: HTMLAudioElement | null = null;
export const stopSpeaking = () => { current?.pause(); current = null; };

/** Speaks text through the backend TTS (edge-tts / ElevenLabs). Resolves when playback ends. */
export async function speak(text: string): Promise<void> {
  stopSpeaking();
  const blob = await api.blob("/tts/speak", { text });
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  current = a;
  await new Promise<void>((resolve) => {
    a.onended = a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    a.play().catch(() => resolve()); // autoplay can be blocked; the text reply is still shown
  });
}

/** Downscale a photo to <=1600px JPEG so uploads stay small (serverless body limit + Groq image tokens). */
export async function shrinkImage(file: File, max = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("resize failed"))), "image/jpeg", 0.85));
}
