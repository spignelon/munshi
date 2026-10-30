import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Keyboard, Mic, MicOff, PhoneOff, Send, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { inr } from "../lib/format";
import type { Plan } from "../lib/types";
import { avatarSignals } from "../lib/avatarSignals";
import { VoiceSession, type TurnResult, type VoiceState } from "../lib/voiceAgent";
import { Avatar } from "./Avatar";
import { actionIcon } from "./PlanCard";
import { Button, Input } from "./ui";

const STATUS: Record<VoiceState, { title: string; hint: string }> = {
  connecting: { title: "Mic shuru ho raha hai…", hint: "Browser mein mic ki permission allow karein" },
  listening: { title: "Boliye, main sun rahi hoon", hint: "Jaise: “Stock check karo aur supplier ko order do”" },
  hearing: { title: "Sun rahi hoon…", hint: "Bolna khatam karke ruk jaiye" },
  thinking: { title: "Soch rahi hoon…", hint: "" },
  speaking: { title: "Munshi bol rahi hai", hint: "Beech mein bol sakte hain, ya orb dabayein" },
  error: { title: "Voice mode shuru nahi ho paaya", hint: "" },
};

/** Full-screen, hands-free voice conversation (ChatGPT-voice style). */
export function VoiceMode({ onClose, initialText }: { onClose: () => void; initialText?: string }) {
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
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");

  const refresh = useCallback(() => { qc.invalidateQueries(); }, [qc]);

  useEffect(() => {
    let cancelled = false;
    const s = new VoiceSession({
      onState: (st) => !cancelled && setState(st),
      onLevel: (l) => { avatarSignals.user = l; orbRef.current?.style.setProperty("--lvl", l.toFixed(3)); },
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
      setTyping(true); // no mic: typing still works
      setFatal((e.name === "NotAllowedError" ? "Mic ki permission chahiye (browser ke address bar mein allow karein). " : `${e.message} `) + "Tab tak neeche type karke bhi bata sakte hain.");
    });
    // a prepared message (dashboard shortcuts) is sent as the first turn; the timer keeps StrictMode's double-mount from sending twice
    const first = initialText ? setTimeout(() => { void s.sendText(initialText); }, 0) : undefined;
    return () => { cancelled = true; clearTimeout(first); s.stop(); };
  }, [onClose, refresh, initialText]);

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

  const sendDraft = (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (!t || state === "thinking") return;
    setDraft("");
    void sessionRef.current?.sendText(t);
  };

  const toggleMute = () => { const m = !muted; setMuted(m); sessionRef.current?.setMuted(m); };
  const pending = plan && plan.status === "proposed" && plan.actions.some((a) => a.status === "proposed");
  const st = STATUS[state];
  const live = state === "hearing" || state === "listening";
  const idleMuted = muted && live; // mute only matters while she is waiting for you; thinking / speaking states still show

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
        <div className="mt-2 grid place-items-center sm:mt-6">
          <button type="button" onClick={() => sessionRef.current?.interrupt()} aria-label={state === "speaking" ? "Munshi ko roken" : "Munshi"} disabled={state !== "speaking"}
            ref={orbRef} style={{ ["--lvl" as string]: 0 }} data-testid="avatar-frame"
            className={clsx("relative grid place-items-center rounded-full transition-[width,height] duration-300 focus-visible:outline-offset-8",
              plan ? "size-36 sm:size-44" : "size-52 sm:size-72")}>
            <span className={clsx("avatar-halo absolute -inset-3 rounded-full bg-saffron-500/20 transition-opacity", live || state === "speaking" ? "opacity-100" : "opacity-40")} aria-hidden />
            <span className="relative block size-full overflow-hidden rounded-full border-4 border-saffron-500/80 bg-[radial-gradient(circle_at_50%_30%,#34457a,#111b33_72%)] shadow-[0_0_70px_rgba(232,145,45,0.35)]">
              <Avatar state={state} muted={muted} />
            </span>
            {state === "thinking" && (
              <span className="absolute -top-1 -right-3 flex items-center gap-1.5 rounded-full bg-cream-50 px-3.5 py-2.5 shadow-lg sm:-right-8" role="status" aria-label="Munshi soch rahi hai" data-testid="avatar-thinking">
                {[0, 1, 2].map((i) => <span key={i} className="dot size-2 rounded-full bg-saffron-600" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </span>
            )}
            <span className={clsx("absolute right-1 bottom-2 grid size-9 place-items-center rounded-full border-2 border-navy-950 sm:right-3 sm:bottom-3 sm:size-10", muted ? "bg-cream-50 text-navy-900" : "bg-saffron-500 text-navy-900")} aria-hidden>
              {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </span>
          </button>
        </div>

        <p className="mt-5 text-center font-display text-2xl font-semibold sm:mt-7 sm:text-3xl" role="status" aria-live="polite" data-testid="voice-status">
          {idleMuted ? "Mic mute hai" : st.title}
        </p>
        <p className="mt-1.5 min-h-5 text-center text-sm text-cream-200/60">{fatal || notice || (idleMuted ? "Unmute karke boliye" : st.hint)}</p>

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
                      {a.status === "done" && a.type === "supplier_order" && <span className="mt-0.5 block text-xs text-emerald-300">{inr(a.result.final_amount)} · {a.result.discount_pct}% chhoot · {a.result.eta} · {a.result.order_ref}</span>}
                      {a.status === "done" && a.type === "udhaar_reminders" && <span className="mt-0.5 block text-xs text-emerald-300">{a.result.sent} reminders bheje{a.result.recovered_simulated ? ` · ${inr(a.result.recovered_simulated)} wapas aaya (simulated)` : ""}</span>}
                      {a.status === "failed" && a.result.error && <span className="mt-0.5 block text-xs text-red-300">{a.result.error}</span>}
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

      <div className="sticky bottom-0 z-10 bg-navy-950/90 backdrop-blur">
      {typing && (
        <form onSubmit={sendDraft} className="relative mx-auto flex w-full max-w-xl items-center gap-2 px-5 pb-2">
          <Input aria-label="Type to Munshi" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Yahan likhiye…" autoComplete="off"
            className="border-cream-200/20 bg-navy-900 text-cream-50 placeholder:text-cream-200/40" />
          <button type="submit" aria-label="Send" disabled={!draft.trim() || state === "thinking"}
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-saffron-500 text-navy-900 hover:bg-saffron-400 disabled:opacity-50"><Send className="size-5" aria-hidden /></button>
        </form>
      )}

      <footer className="relative flex items-center justify-center gap-4 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute mic" : "Mute mic"}
          className={clsx("grid size-14 place-items-center rounded-full transition", muted ? "bg-cream-50 text-navy-900" : "bg-navy-800 text-cream-50 hover:bg-navy-700")}>
          {muted ? <MicOff className="size-6" aria-hidden /> : <Mic className="size-6" aria-hidden />}
        </button>
        <button onClick={() => setTyping((v) => !v)} aria-pressed={typing} aria-label="Type a message"
          className={clsx("grid size-14 place-items-center rounded-full transition", typing ? "bg-cream-50 text-navy-900" : "bg-navy-800 text-cream-50 hover:bg-navy-700")}>
          <Keyboard className="size-6" aria-hidden />
        </button>
        <button onClick={onClose} aria-label="End voice mode" className="flex h-14 items-center gap-2 rounded-full bg-bad px-6 font-semibold text-white hover:bg-red-700">
          <PhoneOff className="size-5" aria-hidden />End
        </button>
      </footer>
      </div>
    </div>
  );
}
