import { useQuery } from "@tanstack/react-query";
import { History, Mic, ScrollText } from "lucide-react";
import { useState } from "react";
import { PlanCard } from "../components/PlanCard";
import { Badge, Card, Empty, ErrorNote, PageHeader, PageLoader } from "../components/ui";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import type { AuditEntry, Plan } from "../lib/types";

export default function Activity() {
  const [tab, setTab] = useState<"plans" | "audit">("plans");
  const plans = useQuery({ queryKey: ["plans"], queryFn: () => api.get<Plan[]>("/plans?limit=30") });
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api.get<AuditEntry[]>("/audit"), enabled: tab === "audit" });

  return (
    <div>
      <PageHeader eyebrow="Har rupaye ka hisaab" title="Activity" />
      <div role="tablist" className="mb-5 inline-flex rounded-xl bg-cream-200 p-1">
        {([["plans", "Plans & approvals", History], ["audit", "Audit log", ScrollText]] as const).map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${tab === k ? "bg-cream-50 shadow-sm" : "text-ink-500"}`}><Icon className="size-4" aria-hidden />{label}</button>
        ))}
      </div>

      {tab === "plans" && (plans.isLoading ? <PageLoader /> : plans.error ? <ErrorNote error={plans.error} /> :
        !plans.data?.length ? <Card><Empty icon={<History className="size-6" />} title="Abhi tak koi activity nahi">Munshi ko kuch kaam dein — har plan, approval aur result yahan trace hoga.</Empty></Card> : (
          <div className="space-y-6">
            {plans.data.map((p) => (
              <article key={p.id} aria-label={`Plan ${p.id}`}>
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="flex items-center gap-1.5 font-display text-lg font-semibold"><Mic className="size-4 text-saffron-700" aria-hidden />“{p.utterance}”</p>
                  <span className="text-xs text-ink-500">{dateTime(p.created_at)} · via {p.channel}</span>
                </div>
                {p.actions.length ? <PlanCard plan={p} /> : <Card className="p-4 text-sm text-ink-500">{p.summary} <Badge>sirf jawab</Badge></Card>}
              </article>
            ))}
          </div>
        ))}

      {tab === "audit" && (audit.isLoading ? <PageLoader /> : audit.error ? <ErrorNote error={audit.error} /> : (
        <Card className="divide-y divide-cream-200">
          {audit.data?.length === 0 && <Empty title="Audit log khaali hai" />}
          {audit.data?.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div><span className="font-mono font-semibold">{e.event}</span> <span className="text-ink-500">{e.ref}</span>
                {e.detail?.utterance || e.detail?.channel ? <span className="text-ink-500"> · {String(e.detail.channel ?? "")}</span> : null}</div>
              <div className="flex items-center gap-2 text-xs text-ink-500"><Badge>{e.actor}</Badge>{dateTime(e.created_at)}</div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
