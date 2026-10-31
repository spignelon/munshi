import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Check, Copy, Database, FlaskConical, Mic2, Phone, PlugZap, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, ErrorNote, Eyebrow, Field, Input, PageHeader, PageLoader, Select, Switch } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime } from "../lib/format";
import type { AdminSettings, AdminStatus, SarvamUsage } from "../lib/types";

type S = AdminSettings["settings"];
const TABS = [["providers", "Providers", PlugZap], ["system", "System", Database], ["users", "Users", Users]] as const;

export default function Admin() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("providers");
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Admin console" title="Providers & system" />
      <div role="tablist" className="mb-6 inline-flex rounded-xl bg-cream-200 p-1">
        {TABS.map(([k, l, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold", tab === k ? "bg-cream-50 shadow-sm" : "text-ink-500")}>
            <Icon className="size-4" aria-hidden />{l}
          </button>
        ))}
      </div>
      {tab === "providers" ? <Providers /> : tab === "system" ? <System /> : <UsersTab />}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Field label={label}>{(id) => (
      <div className="flex gap-2"><Input id={id} readOnly value={value} className="font-mono text-xs" />
        <Button type="button" variant="outline" aria-label={`Copy ${label}`} onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}</Button></div>)}</Field>
  );
}

function Providers() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const { data, error, isLoading } = useQuery({ queryKey: ["admin-settings"], queryFn: () => api.get<AdminSettings>("/admin/settings") });
  const [s, setS] = useState<S | null>(null);
  const [testNum, setTestNum] = useState("");
  useEffect(() => { if (data) setS(data.settings); }, [data]);

  const save = useMutation({
    mutationFn: (v: Partial<S>) => api.put<{ settings: S }>("/admin/settings", { values: v }),
    onSuccess: async (r) => { setS(r.settings); qc.invalidateQueries({ queryKey: ["admin-settings"] }); qc.invalidateQueries({ queryKey: ["admin-status"] }); await refresh(); toast.success("Settings save ho gayi"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const preview = useMutation({
    mutationFn: async (provider: string) => {
      const blob = await api.blob("/admin/test/tts", { provider });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const testWa = useMutation({
    mutationFn: () => api.post<{ status: string; simulated: boolean; error: string }>("/admin/test/whatsapp", { to: testNum }),
    onSuccess: (r) => (r.status === "sent" ? toast.success(r.simulated ? "Simulated WhatsApp sent (mock mode)" : "WhatsApp bhej diya!") : toast.error(r.error || "Failed")),
    onError: (e: Error) => toast.error(e.message),
  });
  const testCall = useMutation({
    mutationFn: () => api.post<{ status: string; simulated: boolean; error: string }>("/admin/test/call", { to: testNum }),
    onSuccess: (r) => (r.status === "failed" ? toast.error(r.error) : toast.success(r.simulated ? "Simulated call (mock mode)" : "Call lag rahi hai…")),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !s) return error ? <ErrorNote error={error} /> : <PageLoader />;
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  const text = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never);
  const eleven = s.tts_provider === "elevenlabs";

  return (
    <div className="space-y-6">
      <Card className={clsx("flex items-start justify-between gap-4 p-5 sm:p-6", s.mock_mode ? "border-violet-300 bg-violet-50" : "border-good/40")}>
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display text-xl font-semibold"><FlaskConical className="size-5 text-violet-700" aria-hidden />Mock mode</p>
          <p className="mt-1 text-sm text-ink-500">
            <b>ON:</b> Twilio calls, WhatsApp, ElevenLabs aur payments simulate hote hain (UI par “Simulated” tag ke saath). <b>OFF:</b> asli providers — keys na ho to action clear error ke saath fail hoga. Groq hamesha asli hai.
          </p>
        </div>
        <Switch id="mock-toggle" label="Mock mode" checked={s.mock_mode} onChange={(v) => { set("mock_mode", v); save.mutate({ mock_mode: v }); }} />
      </Card>

      <Card className="space-y-5 p-5 sm:p-6">
        <div className="flex items-center justify-between"><Eyebrow>Voice · listening & speaking</Eyebrow><Mic2 className="size-5 text-saffron-700" aria-hidden /></div>

        <Field label="Listening (speech-to-text)" hint="Sarvam Saaras is built for Indian languages and Hinglish. If it fails or credits run out, Munshi falls back to Groq Whisper automatically.">
          {(id) => (
            <Select id={id} value={s.stt_provider} onChange={(e) => set("stt_provider", e.target.value as S["stt_provider"])}>
              <option value="sarvam">Sarvam Saaras (recommended)</option>
              <option value="groq">Groq Whisper</option>
            </Select>)}
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-semibold">Speaking (text-to-speech)</p>
          <div role="radiogroup" aria-label="TTS provider" className="grid gap-3 sm:grid-cols-3">
            {([["sarvam", "Sarvam Bulbul", "Natural Indian voices. Uses credits; falls back to Edge."],
               ["edge", "Edge TTS (free)", "Microsoft neural Hindi voices. No key needed."],
               ["elevenlabs", "ElevenLabs", "Premium voices. Needs the key below; falls back to Edge."]] as const).map(([k, t, d]) => (
              <button key={k} type="button" role="radio" aria-checked={s.tts_provider === k} onClick={() => set("tts_provider", k)}
                className={clsx("rounded-2xl border-2 p-4 text-left", s.tts_provider === k ? "border-saffron-500 bg-saffron-500/10" : "border-cream-300 bg-white hover:bg-cream-100")}>
                <p className="font-semibold">{t}</p><p className="mt-1 text-sm text-ink-500">{d}</p></button>
            ))}
          </div>
        </div>

        {(s.stt_provider === "sarvam" || s.tts_provider === "sarvam") && (
          <div className="space-y-4 rounded-2xl bg-cream-100 p-4" data-testid="sarvam-panel">
            <Field label="Sarvam API key" hint={s.sarvam_api_key_set ? "Key saved. Leave as-is to keep it." : "Create one at indus.sarvam.ai → Key management."}>
              {(id) => <Input id={id} type="password" autoComplete="off" value={s.sarvam_api_key} onChange={text("sarvam_api_key")} placeholder="sk_…" />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sarvam voice">{(id) => (
                <Select id={id} value={s.sarvam_speaker} onChange={(e) => set("sarvam_speaker", e.target.value)}>
                  {!data!.sarvam_speakers.some((x) => x.id === s.sarvam_speaker) && <option value={s.sarvam_speaker}>{s.sarvam_speaker}</option>}
                  {data!.sarvam_speakers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>)}</Field>
              <Field label="Credit budget (₹)" hint="Sarvam is skipped once estimated spend (incl. GST) reaches this.">{(id) => <Input id={id} type="number" min={0} value={s.sarvam_budget_inr} onChange={text("sarvam_budget_inr")} />}</Field>
            </div>
            <SarvamMeter u={data!.sarvam_usage} />
          </div>
        )}

        {s.tts_provider === "elevenlabs" && (
          <div className="space-y-4 rounded-2xl bg-cream-100 p-4">
            <Field label="ElevenLabs API key" hint={s.elevenlabs_api_key_set ? "Key saved. Leave as-is to keep it." : "From elevenlabs.io → Profile → API keys."}>
              {(id) => <Input id={id} type="password" autoComplete="off" value={s.elevenlabs_api_key} onChange={text("elevenlabs_api_key")} placeholder="sk_…" />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Voice ID">{(id) => <Input id={id} value={s.elevenlabs_voice_id} onChange={text("elevenlabs_voice_id")} placeholder="21m00Tcm4TlvDq8ikWAM" />}</Field>
              <Field label="Model">{(id) => <Input id={id} value={s.elevenlabs_model} onChange={text("elevenlabs_model")} />}</Field>
            </div>
          </div>
        )}

        <Field label="Edge voice (free fallback)">{(id) => (
          <Select id={id} value={s.edge_voice} onChange={(e) => set("edge_voice", e.target.value)}>
            {data!.edge_voices.map((v) => <option key={v} value={v}>{v}{v.includes("Swara") ? " (female)" : " (male)"}</option>)}</Select>)}</Field>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => preview.mutate(s.tts_provider)} loading={preview.isPending}>▶ Preview voice</Button>
          <Button type="button" onClick={() => save.mutate({ stt_provider: s.stt_provider, tts_provider: s.tts_provider, edge_voice: s.edge_voice, sarvam_api_key: s.sarvam_api_key, sarvam_speaker: s.sarvam_speaker, sarvam_budget_inr: s.sarvam_budget_inr, elevenlabs_api_key: s.elevenlabs_api_key, elevenlabs_voice_id: s.elevenlabs_voice_id, elevenlabs_model: s.elevenlabs_model })} loading={save.isPending}>Save voice</Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between"><Eyebrow>Twilio · calls & WhatsApp</Eyebrow><Phone className="size-5 text-saffron-700" aria-hidden /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account SID">{(id) => <Input id={id} value={s.twilio_account_sid} onChange={text("twilio_account_sid")} placeholder="AC…" autoComplete="off" />}</Field>
          <Field label="Auth token" hint={s.twilio_auth_token_set ? "Saved. Leave as-is to keep it." : undefined}>{(id) => <Input id={id} type="password" value={s.twilio_auth_token} onChange={text("twilio_auth_token")} autoComplete="off" />}</Field>
          <Field label="Voice number (calls)" hint="A Twilio voice-capable number, E.164.">{(id) => <Input id={id} value={s.twilio_voice_number} onChange={text("twilio_voice_number")} placeholder="+1…" />}</Field>
          <Field label="WhatsApp sandbox sender">{(id) => <Input id={id} value={s.twilio_whatsapp_from} onChange={text("twilio_whatsapp_from")} placeholder="whatsapp:+14155238886" />}</Field>
        </div>
        <Field label="Test redirect number" hint="Real mode only: ALL customer/supplier messages and calls go to this number instead (use your sandbox-joined phone). Strongly recommended while testing.">
          {(id) => <Input id={id} value={s.test_redirect_number} onChange={text("test_redirect_number")} placeholder="+91 98xxx xxxxx" />}</Field>
        <Field label="Numbers that skip the redirect" hint="Comma-separated. These numbers (for example a friend helping you test) are contacted directly even while the redirect is on.">
          {(id) => <Input id={id} value={s.test_allowed_numbers} onChange={text("test_allowed_numbers")} placeholder="+91 98xxx xxxxx, +91 …" />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="WhatsApp template SID (optional)" hint="Needed when Twilio says “ContentSid Required” (trial / Tryout senders only allow approved templates). Looks like HX…">
            {(id) => <Input id={id} value={s.twilio_whatsapp_content_sid} onChange={text("twilio_whatsapp_content_sid")} placeholder="HXxxxxxxxx" autoComplete="off" />}</Field>
          <Field label="Template variables (JSON)" hint="{text} is replaced by Munshi's message. Add more keys if the template has more variables.">
            {(id) => <Input id={id} value={s.twilio_whatsapp_content_vars} onChange={text("twilio_whatsapp_content_vars")} placeholder='{"1": "{text}"}' autoComplete="off" />}</Field>
        </div>
        <Field label="Udhaar reminders go by" hint="Calls play the reminder in the voice chosen above. While a test redirect number is set, only one call is placed per approval.">
          {(id) => (
            <Select id={id} value={s.reminder_channel} onChange={(e) => set("reminder_channel", e.target.value as S["reminder_channel"])}>
              <option value="whatsapp">WhatsApp message</option>
              <option value="call">Phone call (spoken Hindi)</option>
              <option value="both">Call + WhatsApp link</option>
            </Select>)}
        </Field>
        <Button type="button" onClick={() => save.mutate({ test_allowed_numbers: s.test_allowed_numbers, reminder_channel: s.reminder_channel, twilio_whatsapp_content_sid: s.twilio_whatsapp_content_sid, twilio_whatsapp_content_vars: s.twilio_whatsapp_content_vars, twilio_account_sid: s.twilio_account_sid, twilio_auth_token: s.twilio_auth_token, twilio_voice_number: s.twilio_voice_number, twilio_whatsapp_from: s.twilio_whatsapp_from, test_redirect_number: s.test_redirect_number })} loading={save.isPending}>Save Twilio</Button>

        <div className="space-y-3 border-t border-cream-200 pt-4">
          <p className="text-sm font-semibold">Paste these into the Twilio console</p>
          <CopyField label="WhatsApp sandbox → “When a message comes in”" value={data!.webhooks.whatsapp} />
          <CopyField label="Voice number → “A call comes in”" value={data!.webhooks.voice_inbound} />
        </div>
        <div className="space-y-3 border-t border-cream-200 pt-4">
          <Field label="Connection test" hint={s.mock_mode ? "Mock mode is ON — tests are simulated." : "Sends a real message / places a real call."}>
            {(id) => <Input id={id} value={testNum} onChange={(e) => setTestNum(e.target.value)} placeholder="+91 98xxx xxxxx" />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!testNum} onClick={() => testWa.mutate()} loading={testWa.isPending}>Send test WhatsApp</Button>
            <Button type="button" variant="outline" disabled={!testNum} onClick={() => testCall.mutate()} loading={testCall.isPending}>Place test call</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SarvamMeter({ u }: { u: SarvamUsage }) {
  const pct = u.budget_inr ? Math.min(100, (u.est_spend_inr / u.budget_inr) * 100) : 100;
  return (
    <div data-testid="sarvam-meter">
      <div className="mb-1 flex justify-between text-xs text-ink-500"><span>Estimated Sarvam spend</span><span>₹{u.est_spend_inr.toFixed(2)} / ₹{u.budget_inr}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-cream-200"><div className={clsx("h-full rounded-full", pct > 80 ? "bg-bad" : "bg-good")} style={{ width: `${pct}%` }} /></div>
      <p className="mt-1.5 text-xs text-ink-500">{u.stt_minutes} min of speech-to-text · {u.tts_chars.toLocaleString("en-IN")} characters spoken</p>
    </div>
  );
}

function Bar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = Math.min(100, (used / max) * 100);
  return (<div><div className="mb-1 flex justify-between text-xs text-ink-500"><span>{label}</span><span>{used} / {max}</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-cream-200"><div className={clsx("h-full rounded-full", pct > 80 ? "bg-bad" : "bg-saffron-500")} style={{ width: `${pct}%` }} /></div></div>);
}

function System() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({ queryKey: ["admin-status"], queryFn: () => api.get<AdminStatus>("/admin/status") });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorNote error={error} />;
  return (
    <div className="space-y-6">
      {!data.db.persistent && (
        <Card className="flex gap-3 border-bad/40 bg-bad/5 p-4 text-sm"><AlertTriangle className="size-5 shrink-0 text-bad" aria-hidden />
          <p><b>Ephemeral database.</b> Data lives in /tmp and resets on cold starts. Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN for persistence.</p></Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5"><Eyebrow>Database</Eyebrow><p className="mt-1 font-display text-2xl font-semibold" data-testid="db-kind">{data.db.kind}</p>
          <p className="mt-2 text-sm text-ink-500">{Object.entries(data.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}</p></Card>
        <Card className="p-5"><Eyebrow>Providers</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-sm">
            {[["Groq", data.groq.configured || data.groq.fake], ["Sarvam", data.sarvam.configured], ["Twilio", data.twilio.configured], ["ElevenLabs", data.elevenlabs.configured]].map(([n, ok]) => (
              <li key={String(n)} className="flex items-center justify-between">{n}<Badge tone={ok ? "good" : "neutral"}>{ok ? "configured" : "not set"}</Badge></li>))}
            <li className="flex items-center justify-between">Mode<Badge tone={data.mock_mode ? "sim" : "good"}>{data.mock_mode ? "mock" : "live"}</Badge></li>
          </ul></Card>
      </div>
      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between"><Eyebrow>Sarvam credits (this deployment)</Eyebrow><Badge tone={data.sarvam.available ? "good" : "neutral"}>{data.sarvam.available ? "active" : data.sarvam.configured ? "budget reached → fallback" : "not set"}</Badge></div>
        <SarvamMeter u={data.sarvam.usage} />
      </Card>
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between"><Eyebrow>Groq free-tier usage (this instance)</Eyebrow><Button size="sm" variant="ghost" onClick={() => refetch()} loading={isFetching}>Refresh</Button></div>
        {Object.entries(data.groq.usage).map(([model, u]) => (
          <div key={model} className="space-y-2"><p className="font-mono text-sm font-semibold">{model}</p>
            <Bar label="requests / min" used={u.requests_last_min} max={u.soft_rpm} />
            {u.soft_tpm && <Bar label="tokens / min" used={u.tokens_last_min} max={u.soft_tpm} />}
            {u.remaining_requests && <p className="text-xs text-ink-500">Groq reports {u.remaining_requests} requests/day and {u.remaining_tokens} tokens/min remaining.</p>}</div>
        ))}
      </Card>
    </div>
  );
}

function UsersTab() {
  const { data, error, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => api.get<{ id: number; email: string; name: string; role: string; created_at: string }[]>("/admin/users") });
  if (isLoading) return <PageLoader />;
  if (error) return <ErrorNote error={error} />;
  return (
    <Card className="divide-y divide-cream-200">
      {data?.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid="user-row">
          <div><p className="font-semibold">{u.name || "—"}</p><p className="text-sm text-ink-500">{u.email}</p></div>
          <div className="flex items-center gap-2"><Badge tone={u.role === "admin" ? "navy" : "neutral"}>{u.role}</Badge><span className="text-xs text-ink-500">{dateTime(u.created_at)}</span></div>
        </div>
      ))}
    </Card>
  );
}
