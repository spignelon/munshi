import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Loader2, Mic, Send, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PlanCard } from "../components/PlanCard";
import { Card, Eyebrow, PageHeader } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { Recorder, speak, stopSpeaking } from "../lib/audio";
import type { ChatMessage, CommandResult, Plan } from "../lib/types";

const SUGGESTIONS = [
  "Diwali aa rahi hai. Stock check karo, Sharma ji ko order do, aur udhaar wapas lao.",
  "Aaj ki sales kaisi rahi?",
  "Purane customers ko wapas bulane ka Diwali offer bhejo",
  "Mujhe stock ke liye loan chahiye",
];
const VOICE_KEY = "munshi.voice";

export default function Munshi() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const [voiceOn, setVoiceOn] = useState(() => localStorage.getItem(VOICE_KEY) !== "off");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const rec = useRef<Recorder | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const history = useQuery({ queryKey: ["history"], queryFn: () => api.get<ChatMessage[]>("/agent/history") });
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api.get<Plan[]>("/plans?limit=30") });
  const planMap = useMemo(() => new Map((plans.data ?? []).map((p) => [p.id, p])), [plans.data]);

  const say = async (t: string) => {
    if (!voiceOn || !t) return;
    setSpeaking(true);
    try { await speak(t); } catch { /* voice is a bonus; the text reply is already shown */ } finally { setSpeaking(false); }
  };

  const command = useMutation({
    mutationFn: (v: { text?: string; audio?: Blob }) => {
      const f = new FormData();
      if (v.text) f.append("text", v.text);
      if (v.audio) f.append("audio", v.audio, "voice.webm");
      return api.form<CommandResult>("/agent/command", f);
    },
    onSuccess: (r) => { qc.invalidateQueries(); void say(r.reply); },
    onError: (e: Error) => {
      const busy = e instanceof ApiError && e.status === 429;
      toast.error(busy ? `Munshi abhi busy hai — ${e.retryAfter ?? 20}s baad dobara try karein.` : e.message);
    },
    onSettled: () => setPending(null),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve, ids }: { id: number; approve: boolean; ids: number[] }) =>
      api.post<{ summary: string; plan: Plan }>(`/plans/${id}/decision`, { approve, action_ids: approve ? ids : undefined, utterance: approve ? "Haan, karo (app)" : "Nahi (app)" }),
    onSuccess: (r, v) => {
      qc.invalidateQueries();
      if (v.approve) { toast.success("Ho gaya!"); void say(r.summary); } else toast.info("Plan cancel kar diya.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = (t: string) => {
    const v = t.trim();
    if (!v || command.isPending) return;
    stopSpeaking();
    setPending(v);
    setText("");
    command.mutate({ text: v });
  };

  // Deep link from the dashboard: /app/munshi?q=...&send=1
  useEffect(() => {
    if (params.get("send") === "1" && params.get("q") && !autoSent.current) {
      autoSent.current = true;
      const q = params.get("q")!;
      setParams({}, { replace: true });
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [history.data?.length, pending, command.isPending, plans.data]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { rec.current?.cancel(); stopSpeaking(); }, []);

  const toggleMic = async () => {
    if (recording) {
      setRecording(false);
      const blob = await rec.current!.stop();
      setPending("🎙 Aapki aawaz sun raha hoon…");
      command.mutate({ audio: blob });
      return;
    }
    if (!Recorder.supported()) return toast.error("Is browser mein mic support nahi hai. Likh kar bhejein.");
    try {
      stopSpeaking();
      rec.current = new Recorder();
      await rec.current.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      toast.error("Mic ki permission chahiye. Browser settings mein allow karein.");
    }
  };

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    localStorage.setItem(VOICE_KEY, next ? "on" : "off");
    if (!next) stopSpeaking();
  };

  const seen = new Set<number>();
  const items = history.data ?? [];
  const submit = (e: FormEvent) => { e.preventDefault(); send(text); };

  return (
    <div className="flex min-h-[calc(100dvh-9.5rem)] flex-col lg:min-h-[calc(100dvh-6rem)]">
      <PageHeader eyebrow="Listen · Think · Act · Check" title="Munshi">
        <button onClick={toggleVoice} aria-pressed={voiceOn} className="flex items-center gap-2 rounded-xl border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold hover:bg-cream-200">
          {voiceOn ? <Volume2 className="size-4 text-saffron-700" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}{voiceOn ? "Munshi bolega" : "Awaaz band"}
        </button>
      </PageHeader>

      <div className="flex-1 space-y-4 pb-4" aria-live="polite">
        {items.length === 0 && !pending && (
          <Card className="grid place-items-center gap-3 px-6 py-12 text-center">
            <div className="grid size-16 place-items-center rounded-full bg-saffron-500/15 text-saffron-700"><Mic className="size-7" aria-hidden /></div>
            <h2 className="text-2xl font-semibold">Raj speaks. Munshi gets it done.</h2>
            <p className="max-w-md text-ink-500">Mic dabayein aur Hinglish mein boliye, ya neeche likhiye. Munshi plan banayega, aur aapki “haan” ke baad hi kuch karega.</p>
          </Card>
        )}
        {items.map((m) => {
          const plan = m.plan_id ? planMap.get(m.plan_id) : undefined;
          const showPlan = m.role === "munshi" && plan && plan.actions.length > 0 && !seen.has(plan.id) && seen.add(plan.id);
          return (
            <div key={m.id} className="space-y-2.5">
              <div className={clsx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={clsx("max-w-[88%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed sm:max-w-[75%]",
                  m.role === "user" ? "rounded-br-md bg-navy-900 text-cream-50" : "rounded-bl-md border border-cream-300/70 bg-cream-50")}>
                  {m.role === "munshi" && <Eyebrow className="mb-0.5">Munshi</Eyebrow>}{m.text}
                  {m.channel !== "web" && <span className="ml-2 text-[10px] uppercase opacity-60">{m.channel}</span>}
                </div>
              </div>
              {showPlan && <PlanCard plan={plan} busy={decide.isPending && decide.variables?.id === plan.id} onDecide={(approve, ids) => decide.mutate({ id: plan.id, approve, ids })} />}
            </div>
          );
        })}
        {pending && (
          <div className="space-y-2.5">
            <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-br-md bg-navy-900 px-4 py-2.5 text-cream-50 sm:max-w-[75%]">{pending}</div></div>
            <div className="flex"><div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-cream-300/70 bg-cream-50 px-4 py-3" role="status" aria-label="Munshi soch raha hai">
              {[0, 1, 2].map((i) => <span key={i} className="dot size-2 rounded-full bg-saffron-500" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div></div>
          </div>
        )}
        {speaking && <p className="flex items-center gap-2 text-xs text-ink-500"><Volume2 className="size-3.5 animate-pulse" aria-hidden />Munshi bol raha hai…</p>}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[4.6rem] z-20 -mx-4 space-y-2.5 bg-gradient-to-t from-cream-100 from-75% to-transparent px-4 pt-6 pb-2 sm:-mx-6 sm:px-6 lg:bottom-0">
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)} disabled={command.isPending} className="shrink-0 rounded-full border border-cream-300 bg-cream-50 px-3.5 py-1.5 text-sm hover:bg-saffron-500/10 disabled:opacity-50">
              {s.length > 42 ? s.slice(0, 40) + "…" : s}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-cream-300 bg-white p-2 shadow-lg shadow-navy-900/5">
          {recording ? (
            <p className="flex-1 px-3 text-[15px] font-medium text-bad" role="status">● Sun raha hoon… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} — poora hone par ■ dabayein</p>
          ) : (
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Munshi ko likhein" placeholder="Munshi ko bolein ya likhein…" autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[15px] placeholder:text-ink-400 focus:outline-none" />
          )}
          {!recording && text.trim() && (
            <button type="submit" disabled={command.isPending} aria-label="Send" className="grid size-11 shrink-0 place-items-center rounded-xl bg-navy-900 text-cream-50 hover:bg-navy-800 disabled:opacity-50">
              {command.isPending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Send className="size-5" aria-hidden />}
            </button>
          )}
          <button type="button" onClick={toggleMic} disabled={command.isPending && !recording} aria-pressed={recording} aria-label={recording ? "Recording rokein aur bhejein" : "Bolkar batayein"}
            className={clsx("relative grid size-11 shrink-0 place-items-center rounded-full text-white transition", recording ? "pulse-ring bg-bad" : "bg-saffron-500 text-navy-900 hover:bg-saffron-400", "disabled:opacity-50")}>
            {recording ? <Square className="size-5 fill-current" aria-hidden /> : <Mic className="size-5" aria-hidden />}
          </button>
        </form>
      </div>
    </div>
  );
}
