import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search, Sparkles, UserX } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Empty, ErrorNote, Input, PageHeader, PageLoader } from "../components/ui";
import { api } from "../lib/api";
import { daysSince, inr } from "../lib/format";
import type { Customer } from "../lib/types";

export default function Customers() {
  const navigate = useNavigate();
  const [lapsed, setLapsed] = useState(false);
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({ queryKey: ["customers", lapsed], queryFn: () => api.get<Customer[]>(`/customers?lapsed=${lapsed}`) });
  const rows = (data ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <PageHeader eyebrow="Jo gaye, unhe bulayein" title="Customers">
        {lapsed && rows.length > 0 && <Button onClick={() => navigate(`/app/munshi?q=${encodeURIComponent("Purane customers ko wapas bulane ka offer bhejo")}&send=1`)}><Sparkles className="size-4" aria-hidden />Munshi se wapas bulwayein</Button>}
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter" className="inline-flex rounded-xl bg-cream-200 p-1">
          {([[false, "Sab"], [true, "30+ din se nahi aaye"]] as const).map(([v, l]) => (
            <button key={String(v)} aria-pressed={lapsed === v} onClick={() => setLapsed(v)} className={clsx("rounded-lg px-4 py-2 text-sm font-semibold", lapsed === v ? "bg-cream-50 shadow-sm" : "text-ink-500")}>{l}</button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
          <Input aria-label="Search customers" className="pl-9" placeholder="Naam khojein" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {isLoading ? <PageLoader /> : error ? <ErrorNote error={error} /> : (
        <Card className="divide-y divide-cream-200">
          {rows.length === 0 && <Empty icon={<UserX className="size-6" />} title="Koi customer nahi mila" />}
          {rows.slice(0, 150).map((c) => {
            const d = daysSince(c.last_visit);
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid="customer-row">
                <div className="min-w-0"><p className="truncate font-semibold">{c.name}</p><p className="text-xs text-ink-500">{c.visits} visits · lifetime {inr(c.lifetime_spend)}</p></div>
                <div className="flex items-center gap-2">
                  {c.balance > 0 && <Badge tone="saffron">udhaar {inr(c.balance)}</Badge>}
                  <Badge tone={d !== null && d > 30 ? "bad" : "good"}>{d === null ? "—" : d === 0 ? "aaj aaye" : `${d} din pehle`}</Badge>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
