import { useEffect, useRef } from "react";
import { avatarSignals } from "../lib/avatarSignals";
import type { VoiceState } from "../lib/voiceAgent";

/**
 * Munshi's animated assistant: a vector character whose face is driven every frame (no React re-renders).
 *  - speaking : the mouth follows the real reply audio (opening = loudness, rounded / spread = spectrum), with nods and brow emphasis
 *  - listening: attentive eyes, soft smile, small nods when the user's voice level rises
 *  - thinking : eyes drift up-left, one brow raised, head tilt, thought dots
 *  - plus blinking, saccades, breathing, idle sway, and a concerned look for errors
 */

const SKIN_L = "#EDBB94", SKIN = "#D69E76", SKIN_D = "#B97C57";
const HAIR = "#1d120d";
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function eye(cx: number, cy: number, dir: 1 | -1, k: string) {
  return (
    <g>
      <path d={`M${cx - 21} ${cy - 8} Q${cx} ${cy - 25} ${cx + 21} ${cy - 8}`} fill="none" stroke={SKIN_D} strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <g data-k={k}>
        <g clipPath={`url(#av-clip-${k})`}>
          <ellipse cx={cx} cy={cy} rx="19" ry="11" fill="#F7F0E8" />
          <ellipse cx={cx} cy={cy - 6} rx="19" ry="6" fill="#000" opacity=".08" />
          <g data-k={`iris-${k}`}>
            <circle cx={cx} cy={cy} r="9.6" fill="url(#av-iris)" />
            <circle cx={cx} cy={cy} r="4.3" fill="#0c0705" />
            <circle cx={cx + 3.2} cy={cy - 3.4} r="2.3" fill="#fff" opacity=".92" />
            <circle cx={cx - 3.4} cy={cy + 3} r="1" fill="#fff" opacity=".55" />
          </g>
        </g>
        <path d={`M${cx - 20} ${cy + 3} Q${cx} ${cy - 24} ${cx + 20} ${cy + 3}`} fill="none" stroke="#150b07" strokeWidth="3.8" strokeLinecap="round" />
        <path d={`M${cx + dir * 19} ${cy + 1} l${dir * 6} -4`} stroke="#150b07" strokeWidth="2.6" strokeLinecap="round" />
        <path d={`M${cx - 17} ${cy + 3.5} Q${cx} ${cy + 14} ${cx + 17} ${cy + 3.5}`} fill="none" stroke="#5a2e22" strokeOpacity=".35" strokeWidth="1.4" />
      </g>
    </g>
  );
}

function mouthShapes(open: number, smile: number, round: number, wide: number) {
  const cx = 200, cy = 280;
  const W = 44 + wide * 12 - round * 14 + Math.max(0, smile) * 4;
  const xl = cx - W / 2, xr = cx + W / 2;
  const yc = cy - smile * 5;
  const O = open * 22;
  const topIn = cy - 1 - smile * 1.5;
  const botIn = cy + 2 * O + 3;
  return {
    clip: `M${xl} ${yc} Q${cx} ${topIn} ${xr} ${yc} Q${cx} ${botIn} ${xl} ${yc}Z`,
    upper: `M${xl} ${yc} Q${cx - W * 0.28} ${cy - 12 - round * 2} ${cx} ${cy - 7 - round * 1.5} Q${cx + W * 0.28} ${cy - 12 - round * 2} ${xr} ${yc} Q${cx} ${topIn} ${xl} ${yc}Z`,
    lower: `M${xr} ${yc} Q${cx} ${botIn} ${xl} ${yc} Q${cx} ${cy + 2 * O + 21 + round * 2} ${xr} ${yc}Z`,
    teethH: clamp(O * 0.6, 0, 8), teethX: xl, teethW: W, teethY: cy - 3,
    tongue: { cy: cy + O * 1.5 + 1, rx: W * 0.2, ry: Math.max(0, O * 0.45) },
    hi: { cy: cy + O + 6, rx: 8 },
    O,
  };
}

export function Avatar({ state, muted }: { state: VoiceState; muted: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const mode = useRef({ state, muted });
  useEffect(() => { mode.current = { state, muted }; }, [state, muted]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = <T extends Element = SVGElement>(k: string) => el.querySelector(`[data-k="${k}"]`) as unknown as T;
    const head = q("head"), body = q("body"), browL = q("browL"), browR = q("browR");
    const eyeL = q("eyeL"), eyeR = q("eyeR"), irisL = q("iris-eyeL"), irisR = q("iris-eyeR");
    const clip = q("clip"), upper = q("upper"), lower = q("lower"), teeth = q("teeth"), tongue = q("tongue"), hi = q("hi");
    const frameEl = el.closest<HTMLElement>('[data-testid="avatar-frame"]'); // its halo swells with her voice
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const amp = reduce ? 0.3 : 1;

    // smoothed animation state
    const s = { gx: 0, gy: 0, brL: 0.15, brR: 0.15, tilt: 0, hx: 0, hy: 0, smile: 0.3, open: 0, round: 0, wide: 0, blink: 0 };
    let t = 0, last = performance.now(), nextBlink = 1.5 + Math.random() * 2.5, blinkT = -1, double = false;
    let sx = 0, sy = 0, nextSacc = 1;
    let peak = 0, raf = 0, shownPeak = -1, blinks = 0;
    const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt;
      const { state: st, muted: mu } = mode.current;
      const speaking = st === "speaking", thinking = st === "thinking", hearing = st === "hearing", err = st === "error";

      // --- mouth energy: the real audio when analysed, otherwise a believable synthetic syllable rhythm
      let env = 0, round = 0, wide = 0;
      if (speaking) {
        if (avatarSignals.live) { env = avatarSignals.mouth; round = avatarSignals.round; wide = avatarSignals.wide; }
        else {
          const gate = Math.sin(t * 2.3) > -0.55 ? 1 : 0.1;
          env = clamp((0.42 + 0.34 * Math.sin(t * 9.2) + 0.18 * Math.sin(t * 5.1 + 1.3)) * gate);
          round = clamp(0.5 + 0.5 * Math.sin(t * 3.1)); wide = clamp(0.5 + 0.5 * Math.sin(t * 2.2 + 1));
        }
      }
      if (env > peak) peak = env;

      // --- targets per state
      if (t > nextSacc) { const k = speaking ? 0.6 : 1; sx = (Math.random() - 0.5) * 3.2 * k; sy = (Math.random() - 0.5) * 2.2 * k; nextSacc = t + 0.7 + Math.random() * 1.8; }
      let tgx = sx, tgy = sy, tbl = 0.18, tbr = 0.18, ttilt = 0, tsmile = 0.38, thx = 0, thy = 0;
      if (thinking) { tgx = -5.5; tgy = -4.6; tbl = 0.95; tbr = 0.15; ttilt = -4.5; tsmile = -0.1; thx = -3; }
      else if (hearing) { tgx = sx * 0.4; tgy = 0.4; tbl = 0.5; tbr = 0.5; ttilt = 2.2; tsmile = 0.22; thy = 1.5; }
      else if (err) { tgx = 0; tgy = 3; tbl = 0.6; tbr = 0.6; ttilt = 2.5; tsmile = -0.3; }
      else if (mu) { tgy = 2.2; tsmile = 0.15; }
      else if (speaking) { tbl = tbr = 0.12 + env * 0.65; ttilt = Math.sin(t * 1.7) * 1.6; tsmile = 0.2 + wide * 0.25; thy = env * 2.6; thx = Math.sin(t * 1.3) * 1.5; }
      const nod = (hearing || st === "listening") ? Math.sin(t * 5) * avatarSignals.user * 1.8 : 0;

      s.gx = ease(s.gx, tgx, 12, dt); s.gy = ease(s.gy, tgy, 12, dt);
      s.brL = ease(s.brL, tbl, 9, dt); s.brR = ease(s.brR, tbr, 9, dt);
      s.tilt = ease(s.tilt, ttilt, 4, dt); s.hx = ease(s.hx, thx, 4, dt); s.hy = ease(s.hy, thy + nod, 10, dt);
      s.smile = ease(s.smile, tsmile, 5, dt);
      s.open = ease(s.open, env, 40, dt); s.round = ease(s.round, round, 18, dt); s.wide = ease(s.wide, wide, 18, dt);

      // --- blinking (random; a quick double-blink sometimes; a bit more often when thinking)
      if (blinkT < 0 && t > nextBlink) { blinkT = 0; double = Math.random() < 0.18; el.setAttribute("data-blinks", String(++blinks)); }
      if (blinkT >= 0) {
        blinkT += dt / 0.15;
        s.blink = blinkT < 1 ? Math.sin(blinkT * Math.PI) : 0;
        if (blinkT >= 1) { blinkT = -1; nextBlink = t + (double ? 0.12 : (thinking ? 1.6 : 2.2) + Math.random() * 3.8); double = false; }
      }
      const squint = Math.max(0, s.smile) * 0.12 + (thinking ? 0.1 : 0);
      const eyeScale = Math.max(0.04, 1 - 0.96 * s.blink - squint);

      // --- apply
      const breath = Math.sin(t * 1.6);
      const hx = s.hx * amp, hy = (s.hy + breath * 0.9) * amp;
      head.setAttribute("transform", `translate(${hx.toFixed(2)} ${hy.toFixed(2)}) rotate(${(s.tilt * amp + Math.sin(t * 0.7) * 0.6 * amp).toFixed(2)} 200 335)`);
      body.setAttribute("transform", `translate(0 440) scale(1 ${(1 + 0.006 * breath * amp).toFixed(4)}) translate(0 -440)`);
      const brow = (n: Element, v: number, cx: number, sign: number) =>
        n.setAttribute("transform", `translate(0 ${(-v * 7).toFixed(2)}) rotate(${(sign * v * 5).toFixed(2)} ${cx} 148)`);
      brow(browL, s.brL, 160, -1); brow(browR, s.brR, 240, 1);
      for (const e of [eyeL, eyeR]) e.setAttribute("transform", `translate(0 181) scale(1 ${eyeScale.toFixed(3)}) translate(0 -181)`);
      const g = `translate(${(s.gx).toFixed(2)} ${(s.gy).toFixed(2)})`;
      irisL.setAttribute("transform", g); irisR.setAttribute("transform", g);

      const m = mouthShapes(s.open, s.smile, s.round, s.wide);
      clip.setAttribute("d", m.clip);
      upper.setAttribute("d", m.upper); lower.setAttribute("d", m.lower);
      teeth.setAttribute("x", String(m.teethX)); teeth.setAttribute("y", String(m.teethY)); teeth.setAttribute("width", String(m.teethW));
      teeth.setAttribute("height", m.teethH.toFixed(2)); teeth.setAttribute("opacity", m.O > 3 ? "1" : "0");
      tongue.setAttribute("cy", m.tongue.cy.toFixed(2)); tongue.setAttribute("rx", m.tongue.rx.toFixed(2)); tongue.setAttribute("ry", m.tongue.ry.toFixed(2));
      tongue.setAttribute("opacity", m.O > 7 ? "1" : "0");
      hi.setAttribute("cy", m.hi.cy.toFixed(2));

      frameEl?.style.setProperty("--speak", env.toFixed(3));
      if (Math.abs(peak - shownPeak) > 0.02) { shownPeak = peak; el.setAttribute("data-peak-mouth", peak.toFixed(2)); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={root} data-testid="avatar" data-state={state} data-peak-mouth="0" data-blinks="0" className="relative h-full w-full">
      <svg viewBox="0 0 400 440" className="absolute inset-0 h-full w-full" role="img" aria-label="Munshi, your AI assistant" preserveAspectRatio="xMidYMax slice">
        <defs>
          <radialGradient id="av-skin" cx="50%" cy="38%" r="68%"><stop offset="0" stopColor={SKIN_L} /><stop offset=".55" stopColor={SKIN} /><stop offset="1" stopColor={SKIN_D} /></radialGradient>
          <linearGradient id="av-neck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={SKIN_D} /><stop offset="1" stopColor={SKIN} /></linearGradient>
          <linearGradient id="av-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#33211a" /><stop offset="1" stopColor="#0f0a08" /></linearGradient>
          <linearGradient id="av-kurta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F0A64E" /><stop offset="1" stopColor="#C97712" /></linearGradient>
          <linearGradient id="av-dupatta" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2a3f78" /><stop offset="1" stopColor="#17254a" /></linearGradient>
          <radialGradient id="av-iris" cx="50%" cy="40%" r="62%"><stop offset="0" stopColor="#8a5530" /><stop offset=".7" stopColor="#3b2112" /><stop offset="1" stopColor="#1f1008" /></radialGradient>
          <linearGradient id="av-lip" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C4544F" /><stop offset="1" stopColor="#A83F42" /></linearGradient>
          <filter id="av-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
          <clipPath id="av-clip-eyeL"><ellipse cx="158" cy="181" rx="19" ry="11" /></clipPath>
          <clipPath id="av-clip-eyeR"><ellipse cx="242" cy="181" rx="19" ry="11" /></clipPath>
          <clipPath id="av-mouthclip"><path data-k="clip" d="" /></clipPath>
        </defs>

        {/* hair behind */}
        <path d="M104 214 C92 92 150 38 200 38 C250 38 308 92 296 214 C302 284 318 344 324 408 L76 408 C82 344 98 284 104 214Z" fill="url(#av-hair)" />

        {/* shoulders & kurta */}
        <g data-k="body">
          <path d="M34 440 C46 362 118 334 200 334 C282 334 354 362 366 440Z" fill="url(#av-kurta)" />
          <path d="M150 338 Q200 396 250 338 Q200 350 150 338Z" fill={SKIN_D} />
          <path d="M150 338 Q200 398 250 338" fill="none" stroke="#F8F4EC" strokeWidth="5" strokeLinecap="round" />
          <path d="M34 440 C56 378 110 346 160 340 L176 352 C132 366 102 402 98 440Z" fill="url(#av-dupatta)" />
          <path d="M366 440 C344 388 298 350 244 342 L230 352 C280 364 318 398 330 440Z" fill="url(#av-dupatta)" />
          <path d="M172 352 Q200 384 228 352" fill="none" stroke="#E8B44A" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="200" cy="377" r="4.2" fill="#E8B44A" />
          {/* hair locks over the shoulders */}
          <path d="M112 250 C98 304 94 346 98 398 L130 402 C132 346 136 302 142 268Z" fill="url(#av-hair)" />
          <path d="M288 250 C302 304 306 346 302 398 L270 402 C268 346 264 302 258 268Z" fill="url(#av-hair)" />
        </g>

        {/* neck */}
        <path d="M168 292 L168 348 Q200 368 232 348 L232 292Z" fill="url(#av-neck)" />
        <ellipse cx="200" cy="330" rx="36" ry="15" fill="#000" opacity=".2" />

        {/* head */}
        <g data-k="head">
          <ellipse cx="112" cy="216" rx="11" ry="17" fill={SKIN} />
          <ellipse cx="288" cy="216" rx="11" ry="17" fill={SKIN} />
          <circle cx="112" cy="240" r="4" fill="#E8B44A" /><path d="M112 244 l0 9" stroke="#E8B44A" strokeWidth="2" />
          <circle cx="288" cy="240" r="4" fill="#E8B44A" /><path d="M288 244 l0 9" stroke="#E8B44A" strokeWidth="2" />

          <path d="M200 66 C140 66 112 120 112 190 C112 256 140 314 200 324 C260 314 288 256 288 190 C288 120 260 66 200 66Z" fill="url(#av-skin)" />
          <ellipse cx="200" cy="118" rx="46" ry="22" fill="#fff" opacity=".1" filter="url(#av-blur)" />
          <ellipse cx="200" cy="312" rx="40" ry="9" fill={SKIN_D} opacity=".22" filter="url(#av-blur)" />
          <ellipse cx="138" cy="242" rx="24" ry="15" fill="#E0736B" opacity=".26" filter="url(#av-blur)" />
          <ellipse cx="262" cy="242" rx="24" ry="15" fill="#E0736B" opacity=".26" filter="url(#av-blur)" />

          {/* nose */}
          <path d="M200 192 Q195 222 187 240 Q200 251 213 240 Q205 222 200 192" fill="none" stroke={SKIN_D} strokeOpacity=".4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="191" cy="245" rx="4.4" ry="2.3" fill={SKIN_D} opacity=".55" /><ellipse cx="209" cy="245" rx="4.4" ry="2.3" fill={SKIN_D} opacity=".55" />
          <path d="M204 196 Q207 222 211 236" fill="none" stroke="#fff" strokeOpacity=".16" strokeWidth="3" strokeLinecap="round" />

          {eye(158, 181, -1, "eyeL")}
          {eye(242, 181, 1, "eyeR")}
          <g data-k="browL"><path d="M136 152 Q158 132 186 146" fill="none" stroke={HAIR} strokeWidth="6" strokeLinecap="round" opacity=".93" /></g>
          <g data-k="browR"><path d="M264 152 Q242 132 214 146" fill="none" stroke={HAIR} strokeWidth="6" strokeLinecap="round" opacity=".93" /></g>

          {/* mouth */}
          <g clipPath="url(#av-mouthclip)">
            <rect x="0" y="0" width="400" height="440" fill="#3a0f12" />
            <rect data-k="teeth" x="170" y="277" width="60" height="0" fill="#F6EFE6" />
            <ellipse data-k="tongue" cx="200" cy="284" rx="8" ry="0" fill="#B34A4C" />
          </g>
          <path data-k="upper" d="" fill="url(#av-lip)" />
          <path data-k="lower" d="" fill="url(#av-lip)" />
          <ellipse data-k="hi" cx="200" cy="286" rx="8" ry="1.6" fill="#fff" opacity=".28" />

          {/* front hair, centre part */}
          <path d="M200 50 C140 52 96 102 98 196 C98 232 104 262 112 292 C110 236 112 188 128 150 C144 112 176 98 200 84Z" fill="url(#av-hair)" />
          <path d="M200 50 C260 52 304 102 302 196 C302 232 296 262 288 292 C290 236 288 188 272 150 C256 112 224 98 200 84Z" fill="url(#av-hair)" />
          <path d="M150 100 C128 132 120 172 118 222" fill="none" stroke="#6a4636" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
          <path d="M250 100 C272 132 280 172 282 222" fill="none" stroke="#6a4636" strokeOpacity=".3" strokeWidth="3" strokeLinecap="round" />
        </g>
      </svg>

    </div>
  );
}
