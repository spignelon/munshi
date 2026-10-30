import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Mic, MicOff, PhoneOff, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { inr } from "../lib/format";
import type { Plan } from "../lib/types";
import { VoiceSession, type TurnResult, type VoiceState } from "../lib/voiceAgent";
import { actionIcon } from "./PlanCard";
import { Button } from "./ui";

const STATUS: Record<VoiceState, { title: string; hint: string }> = {
  connecting: { title: "Mic shuru ho raha hai…", hint: "Browser mein mic ki permission allow karein" },
  listening: { title: "Boliye, main sun raha hoon", hint: "Jaise: “Stock check karo aur supplier ko order do”" },
  hearing: { title: "Sun raha hoon…", hint: "Bolna khatam karke ruk jaiye" },
  thinking: { title: "Soch raha hoon…", hint: "" },
  speaking: { title: "Munshi bol raha hai", hint: "Beech mein bol sakte hain, ya orb dabayein" },
  error: { title: "Voice mode shuru nahi ho paaya", hint: "" },
};

/** Full-screen, hands-free voice conversation (ChatGPT-voice style). */
export function VoiceMode({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const sessionRef = useRef<VoiceSession | null>(null);
  const orbRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<VoiceState>("connecting");
  const [muted, setMuted] = useState(false);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [providers, setProviders] = useState<TurnResult["providers"]>();
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState("");

  const refresh = useCallback(() => { qc.invalidateQueries(); }, [qc]);

  useEffect(() => {
    let cancelled = false;
    const s = new VoiceSession({
      onState: (st) => !cancelled && setState(st),
      onLevel: (l) => orbRef.current?.style.setProperty("--lvl", l.toFixed(3)),
      onTurn: (r) => {
        if (cancelled) return;
        if (r.empty) { setNotice("Samajh nahi aaya, dobara boliye."); return; }
        setNotice("");
        setHeard(r.transcript);
        setReply(r.reply ?? "");
        setProviders(r.providers);
        // keep showing a plan while it still needs a decision; otherwise show the latest result briefly
        setPlan(r.plan && r.plan.actions.length ? r.plan : null);
        refresh();
      },
      onError: (m) => !cancelled && setNotice(m),
      onIdle: () => { if (!cancelled) { toast.info("Kaafi der se kuch suna nahi, voice mode band kar diya."); onClose(); } },
    });
    sessionRef.current = s;
    s.start().catch((e: Error) => {
      if (cancelled) return;
      setState("error");
      setFatal(e.name === "NotAllowedError" ? "Mic ki permission chahiye. Browser ke address bar mein mic allow karke dobara try karein." : e.message);
    });
    return () => { cancelled = true; s.stop(); };
  }, [onClose, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const decide = async (approve: boolean) => {
    if (!plan) return;
    setBusy(true);
    try {
      const ids = plan.actions.filter((a) => a.status === "proposed").map((a) => a.id);
      const r = await api.post<{ summary: string; plan: Plan }>(`/plans/${plan.id}/decision`, {
        approve, action_ids: approve ? ids : undefined, utterance: approve ? "Haan (voice mode button)" : "Nahi (voice mode button)" });
      setPlan(r.plan);
      const msg = approve ? r.summary : "Theek hai, plan cancel kar diya.";
      setReply(msg);
      refresh();
      void sessionRef.current?.say(msg);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const toggleMute = () => { const m = !muted; setMuted(m); sessionRef.current?.setMuted(m); };
  const pending = plan && plan.status === "proposed" && plan.actions.some((a) => a.status === "proposed");
  const st = STATUS[state];
  const live = state === "hearing" || state === "listening";

  return (
    <div role="dialog" aria-modal="true" aria-label="Munshi voice mode" data-testid="voice-mode" data-state={state}
      className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-navy-950 text-cream-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_30%,rgba(232,145,45,0.18),transparent)]" aria-hidden />

      <header className="sticky top-0 z-10 flex items-center justify-between bg-navy-950/85 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-2 backdrop-blur">
        <div>
          <p className="font-display text-xl font-semibold">Munshi · Voice</p>
          {providers && <p className="text-[11px] tracking-wide text-cream-200/50 uppercase" data-testid="voice-providers">
            {providers.stt === "sarvam" ? "Sarvam Saaras" : "Whisper"} · {providers.tts === "sarvam" ? "Sarvam Bulbul" : providers.tts === "elevenlabs" ? "ElevenLabs" : "Edge voice"}</p>}
        </div>
        <button onClick={onClose} aria-label="Close voice mode" className="grid size-11 place-items-center rounded-full bg-navy-800 text-cream-100 hover:bg-navy-700"><X className="size-5" /></button>
      </header>

      <main className="relative flex flex-1 flex-col items-center px-5 pb-4">
        <div className="mt-2 grid place-items-center sm:mt-8">
          <button type="button" onClick={() => sessionRef.current?.interrupt()} aria-label={state === "speaking" ? "Munshi ko roken" : "Voice orb"} disabled={state !== "speaking"}
            ref={orbRef} style={{ ["--lvl" as string]: 0 }}
            className="relative grid size-40 place-items-center rounded-full sm:size-64 focus-visible:outline-offset-8">
            {(live || state === "speaking") && <span className="orb-ring absolute inset-0 rounded-full bg-saffron-500/25" aria-hidden />}
            <span className={clsx("absolute inset-6 rounded-full bg-gradient-to-br from-saffron-400 to-saffron-600 shadow-[0_0_80px_rgba(232,145,45,0.45)]",
              state === "speaking" && "orb-speak", state === "thinking" && "orb-think", live && "orb-live")} aria-hidden />
            {state === "thinking" && <span className="absolute inset-2 animate-spin rounded-full border-4 border-transparent border-t-saffron-400/80" aria-hidden />}
            <span className="relative text-navy-900">{muted ? <MicOff className="size-10" aria-hidden /> : <Mic className="size-10" aria-hidden />}</span>
          </button>
        </div>

        <p className="mt-5 text-center font-display text-2xl font-semibold sm:mt-7 sm:text-3xl" role="status" aria-live="polite" data-testid="voice-status">
          {muted ? "Mic mute hai" : st.title}
        </p>
        <p className="mt-1.5 min-h-5 text-center text-sm text-cream-200/60">{fatal || notice || (muted ? "Unmute karke boliye" : st.hint)}</p>

        <div className="mt-5 w-full max-w-xl space-y-3 text-center" aria-live="polite">
          {heard && <p className="text-lg text-cream-200/70 italic" data-testid="voice-heard">“{heard}”</p>}
          {reply && <p className="text-xl leading-snug font-medium" data-testid="voice-reply">{reply}</p>}
        </div>

        {plan && (
          <section aria-label="Plan" data-testid="voice-plan" className="mt-6 w-full max-w-xl rounded-2xl border border-cream-200/15 bg-navy-900/80 p-4 text-left backdrop-blur">
            <p className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-saffron-400 uppercase">
              <ShieldCheck className="size-4" aria-hidden />{pending ? "Aapki haan ka intezaar" : `Plan · ${plan.status}`}</p>
            <ul className="space-y-2">
              {plan.actions.map((a) => {
                const Icon = actionIcon[a.type];
                return (
                  <li key={a.id} className="flex items-start gap-2.5 text-sm">
                    <Icon className="mt-0.5 size-4 shrink-0 text-saffron-400" aria-hidden />
                    <span className="min-w-0 flex-1">{a.title}
                      {a.blocked_reason && <span className="mt-0.5 block text-xs text-red-300">{a.blocked_reason}</span>}
                      {a.status === "done" && a.type === "supplier_order" && <span className="mt-0.5 block text-xs text-emerald-300">{inr(a.result.final_amount)} · {a.result.discount_pct}% chhoot · {a.result.eta}</span>}
                    </span>
                    <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", a.status === "done" ? "bg-emerald-400/20 text-emerald-300" : a.status === "proposed" ? "bg-saffron-500/20 text-saffron-300" : "bg-cream-200/10 text-cream-200/70")}>{a.status}</span>
                  </li>
                );
              })}
            </ul>
            {pending && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-cream-200/10 pt-3">
                <p className="text-xs text-cream-200/60">Boliye “haan” ya “nahi”, ya button dabayein</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="onDark" onClick={() => decide(false)} disabled={busy}><X className="size-4" aria-hidden />Nahi</Button>
                  <Button size="sm" onClick={() => decide(true)} loading={busy}><Check className="size-4" aria-hidden />Haan, karo</Button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="relative flex items-center justify-center gap-4 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute mic" : "Mute mic"}
          className={clsx("grid size-14 place-items-center rounded-full transition", muted ? "bg-cream-50 text-navy-900" : "bg-navy-800 text-cream-50 hover:bg-navy-700")}>
          {muted ? <MicOff className="size-6" aria-hidden /> : <Mic className="size-6" aria-hidden />}
        </button>
        <button onClick={onClose} aria-label="End voice mode" className="flex h-14 items-center gap-2 rounded-full bg-bad px-6 font-semibold text-white hover:bg-red-700">
          <PhoneOff className="size-5" aria-hidden />End
        </button>
      </footer>
    </div>
  );
}
