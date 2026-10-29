import clsx from "clsx";
import { Ban, BookOpen, Check, ChevronDown, Gift, Landmark, MessageCircle, PackageSearch, Phone, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { dateTime, inr } from "../lib/format";
import type { Action, ActionStatus, ActionType, Plan } from "../lib/types";
import { Badge, Button, Card, SimBadge } from "./ui";

export const actionIcon: Record<ActionType, typeof Phone> = {
  supplier_order: Phone, udhaar_reminders: MessageCircle, winback_offer: Gift, loan_offer: Landmark, stock_report: PackageSearch, ledger_import: BookOpen,
};
const statusTone: Record<ActionStatus, "neutral" | "saffron" | "good" | "bad" | "navy"> = {
  proposed: "saffron", approved: "saffron", executing: "saffron", done: "good", failed: "bad", rejected: "neutral", blocked: "bad",
};
const statusLabel: Record<ActionStatus, string> = {
  proposed: "Approval chahiye", approved: "Approved", executing: "Chal raha hai…", done: "Ho gaya", failed: "Fail", rejected: "Rejected", blocked: "Blocked",
};

export function ActionRow({ a, checked, onToggle }: { a: Action; checked?: boolean; onToggle?: (v: boolean) => void }) {
  const Icon = actionIcon[a.type] ?? Phone;
  const selectable = a.status === "proposed" && onToggle;
  const r = a.result || {};
  return (
    <li className={clsx("flex gap-3 rounded-xl border p-3", a.status === "blocked" || a.status === "failed" ? "border-bad/30 bg-bad/5" : "border-cream-300/80 bg-white")}>
      {selectable ? (
        <input type="checkbox" checked={checked} onChange={(e) => onToggle!(e.target.checked)} aria-label={`Approve: ${a.title}`}
          className="mt-1 size-5 shrink-0 accent-saffron-500" />
      ) : (
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-cream-200 text-saffron-700"><Icon className="size-4" aria-hidden /></span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[15px] leading-snug font-semibold">{a.title}</p>
          <Badge tone={statusTone[a.status]}>{statusLabel[a.status]}</Badge>
          {a.simulated && a.status !== "proposed" && <SimBadge />}
        </div>
        {a.detail && <p className="mt-1 text-sm text-ink-500">{a.detail}</p>}
        {a.blocked_reason && <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-bad"><Ban className="mt-0.5 size-4 shrink-0" aria-hidden />{a.blocked_reason}</p>}
        {a.status === "failed" && r.error && <p className="mt-1.5 text-sm font-medium text-bad">{r.error}</p>}
        {a.status === "done" && a.type === "supplier_order" && (
          <p className="mt-1.5 text-sm text-good">
            {inr(r.final_amount)} · {r.discount_pct}% chhoot ({inr(r.discount_amount)} bachaye) · {r.eta} · <span className="font-mono text-xs">{r.order_ref}</span>
          </p>
        )}
        {a.status === "done" && a.type === "udhaar_reminders" && (
          <p className="mt-1.5 text-sm text-good">{r.sent} reminders bheje{r.recovered_simulated ? ` · ${inr(r.recovered_simulated)} wapas aaya (simulated)` : ""}{r.capped_for_test ? " · test mode: pehle 3 hi" : ""}</p>
        )}
        {a.status === "done" && a.type === "winback_offer" && <p className="mt-1.5 text-sm text-good">{r.sent} customers ko offer bheja</p>}
        {a.status === "done" && a.type === "loan_offer" && <p className="mt-1.5 text-sm text-good">{inr(r.offer_amount)} · {r.tenure_months} mahine · pre-approved (simulated offer)</p>}
        {a.status === "done" && a.type === "ledger_import" && <p className="mt-1.5 text-sm text-good">{r.imported} entries ledger mein jud gayi</p>}
      </div>
      {a.amount > 0 && a.status === "proposed" && <p className="shrink-0 font-display text-lg font-semibold">{inr(a.amount)}</p>}
    </li>
  );
}

export function CallTranscript({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  if (!plan.calls?.length) return null;
  return (
    <div className="space-y-2">
      {plan.calls.map((c) => (
        <div key={c.id} className="rounded-xl border border-cream-300/80 bg-white">
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left">
            <span className="flex items-center gap-2 text-sm font-semibold"><Phone className="size-4 text-saffron-700" aria-hidden />Call transcript — {c.counterpart}{c.simulated && <SimBadge />}</span>
            <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <ol className="space-y-2 border-t border-cream-200 px-3.5 py-3">
              {c.transcript.map((t, i) => (
                <li key={i} className={clsx("flex", t.speaker === "munshi" ? "justify-start" : "justify-end")}>
                  <div className={clsx("max-w-[85%] rounded-2xl px-3 py-2 text-sm", t.speaker === "munshi" ? "bg-navy-900 text-cream-50" : "bg-saffron-500/15")}>
                    <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider opacity-60">{t.speaker === "munshi" ? "Munshi" : c.counterpart}</p>{t.text}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

export function MessagesSample({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false);
  const msgs = plan.messages ?? [];
  if (!msgs.length) return null;
  const sims = msgs.every((m) => m.simulated);
  return (
    <div className="rounded-xl border border-cream-300/80 bg-white">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4 text-saffron-700" aria-hidden />{msgs.length} WhatsApp messages{sims && <SimBadge />}</span>
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="max-h-72 divide-y divide-cream-200 overflow-y-auto border-t border-cream-200">
          {msgs.slice(0, 30).map((m) => (
            <li key={m.id} className="px-3.5 py-2.5 text-sm">
              <p className="flex items-center justify-between gap-2 font-semibold">{m.recipient_name}<Badge tone={m.status === "sent" ? "good" : "bad"}>{m.status}</Badge></p>
              <p className="mt-0.5 break-words text-ink-500">{m.body}</p>
              {m.error && <p className="mt-0.5 text-bad">{m.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A plan with approve/reject controls (when pending) and results (when executed). */
export function PlanCard({ plan, onDecide, busy }: { plan: Plan; onDecide?: (approve: boolean, ids: number[]) => void; busy?: boolean }) {
  const pending = plan.status === "proposed";
  const movable = plan.actions.filter((a) => a.status === "proposed");
  const [sel, setSel] = useState<Set<number>>(new Set(movable.map((a) => a.id)));
  const toggle = (id: number, v: boolean) => setSel((s) => { const n = new Set(s); v ? n.add(id) : n.delete(id); return n; });
  const total = movable.filter((a) => sel.has(a.id)).reduce((s, a) => s + a.amount, 0);

  return (
    <Card className="overflow-hidden border-saffron-500/40" data-testid="plan-card">
      <div className="flex items-center justify-between gap-2 border-b border-cream-300/70 bg-cream-200/50 px-4 py-2.5">
        <p className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-saffron-700 uppercase"><ShieldCheck className="size-4" aria-hidden />
          {pending ? "Plan — aapki haan ka intezaar" : `Plan #${plan.id}`}</p>
        <Badge tone={plan.status === "executed" ? "good" : plan.status === "rejected" ? "neutral" : plan.status === "failed" || plan.status === "blocked" ? "bad" : "saffron"}>{plan.status}</Badge>
      </div>
      <div className="space-y-3 p-3.5 sm:p-4">
        <ul className="space-y-2">
          {plan.actions.map((a) => <ActionRow key={a.id} a={a} checked={sel.has(a.id)} onToggle={pending && onDecide ? (v) => toggle(a.id, v) : undefined} />)}
        </ul>
        <CallTranscript plan={plan} />
        <MessagesSample plan={plan} />
        {pending && onDecide && movable.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 pt-3">
            <p className="text-sm text-ink-500">{sel.size} of {movable.length} selected{total > 0 && <> · kharch <b className="text-navy-900">{inr(total)}</b></>}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onDecide(false, [])} disabled={busy}><X className="size-4" aria-hidden />Nahi</Button>
              <Button onClick={() => onDecide(true, [...sel])} loading={busy} disabled={sel.size === 0}><Check className="size-4" aria-hidden />Haan, karo</Button>
            </div>
          </div>
        )}
        {plan.approvals.map((ap) => (
          <p key={ap.id} className="flex items-start gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-good" aria-hidden />
            {ap.decision === "approved" ? "Approved" : "Rejected"} via {ap.channel} · “{ap.utterance}” · {dateTime(ap.created_at)}
          </p>
        ))}
      </div>
    </Card>
  );
}
