import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BookOpen, CalendarClock, IndianRupee, Landmark, Mic, PackageSearch, ShieldCheck, Sparkles, } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlanCard } from "../components/PlanCard";
import { Badge, Button, Card, ErrorNote, Eyebrow, PageHeader, PageLoader, SimBadge, Stat } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { compact, firstName, inr, shortDay } from "../lib/format";
import type { Dashboard as Dash, Plan } from "../lib/types";

const SAMPLE_PROMPT = "Stock check karo, supplier ko order do, aur udhaar wapas lao.";

export default function Dashboard() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<Dash>("/dashboard") });
  const brief = useMutation({
    mutationFn: () => api.post("/brief"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Evening brief taiyaar hai"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const decide = useMutation({
    mutationFn: ({ id, approve, ids }: { id: number; approve: boolean; ids: number[] }) =>
      api.post<{ summary: string; plan: Plan }>(`/plans/${id}/decision`, { approve, action_ids: approve ? ids : undefined, utterance: approve ? "Approved from dashboard" : "Rejected from dashboard" }),
    onSuccess: (r, v) => { qc.invalidateQueries(); toast[v.approve ? "success" : "info"](v.approve ? r.summary : "Plan cancel kar diya."); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorNote error={error} />;
  const { sales, udhaar, stock, festival } = data;
  const empty = !session?.shop.demo_loaded && sales.series.length === 0;
  const chart = sales.series.slice(-30).map((s) => ({ ...s, label: shortDay(s.day) }));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`${festival.name} in ${festival.days_away} days`} title={`Namaste, ${firstName(session!.user.name)} ji`}>
        <Badge tone="saffron"><CalendarClock className="size-3.5" aria-hidden />{festival.name}: {new Date(festival.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Badge>
      </PageHeader>

      {empty && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-saffron-500/50 bg-saffron-500/8 p-5">
          <div><p className="font-display text-lg font-semibold">Abhi dukaan khaali hai</p><p className="text-sm text-ink-500">Demo data load karein ya apna ledger / stock add karein.</p></div>
          <Button onClick={async () => { await api.post("/shop/demo-data"); qc.invalidateQueries(); }}><Sparkles className="size-4" aria-hidden />Load demo data</Button>
        </Card>
      )}

      <Card className="relative overflow-hidden border-navy-900 bg-navy-900 p-5 text-cream-50 sm:p-7">
        <div className="pointer-events-none absolute -right-16 -bottom-20 size-64 rounded-full bg-saffron-500/20 blur-3xl" aria-hidden />
        <Eyebrow dark>Munshi se kahein</Eyebrow>
        <p className="mt-2 max-w-3xl font-display text-xl leading-snug italic sm:text-2xl">“{SAMPLE_PROMPT}”</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => navigate(`/app/munshi?q=${encodeURIComponent(SAMPLE_PROMPT)}&send=1`)}><Sparkles className="size-4" aria-hidden />Yeh bhej dein</Button>
          <Button variant="onDark" onClick={() => navigate("/app/munshi")}><Mic className="size-4" aria-hidden />Voice mode</Button>
        </div>
      </Card>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Aaj ki sales" icon={<IndianRupee className="size-5" aria-hidden />} value={inr(sales.today)}
          sub={`${sales.today_payments} payments abhi tak · 7-din avg ${compact(sales.avg_7d)}/din`} />
        <Stat label="Udhaar stuck" icon={<BookOpen className="size-5" aria-hidden />} value={inr(udhaar.total)} sub={`${udhaar.count} customers`} />
        <Stat label={`${festival.name} stock gap`} icon={<PackageSearch className="size-5" aria-hidden />} value={`${stock.festive_low_count} items`} sub={stock.festive_low_count ? `${inr(stock.festive_order_total)} order from ${stock.festive_supplier}` : `${stock.low_count} items kam stock mein`} />
        <Stat tone="highlight" label="Approval chahiye" icon={<ShieldCheck className="size-5" aria-hidden />} value={data.pending_plans.length} sub={data.pending_plans.length ? "Neeche review karein" : "Sab clear hai"} />
      </section>

      {data.pending_plans.length > 0 && (
        <section aria-label="Pending approvals" className="space-y-3">
          <h2 className="text-xl font-semibold">Aapki haan ka intezaar</h2>
          {data.pending_plans.map((p) => (
            <div key={p.id}>
              <p className="mb-1.5 text-sm text-ink-500">Aapne kaha: “{p.utterance}”</p>
              <PlanCard plan={p} busy={decide.isPending && decide.variables?.id === p.id} onDecide={(approve, ids) => decide.mutate({ id: p.id, approve, ids })} />
            </div>
          ))}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between"><h2 className="text-lg font-semibold">Paytm sales — 30 din</h2><p className="text-sm text-ink-500">Kul {compact(sales.total_30d)}</p></div>
          <div className="h-60 w-full" role="img" aria-label="Daily Paytm sales for the last 30 days">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8912D" stopOpacity={0.4} /><stop offset="100%" stopColor="#E8912D" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#e6dbc4" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5b6475" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis tickFormatter={(v) => compact(v)} tick={{ fontSize: 11, fill: "#5b6475" }} tickLine={false} axisLine={false} width={52} />
                <Tooltip formatter={(v) => [inr(Number(v)), "Sales"]} contentStyle={{ borderRadius: 12, border: "1px solid #e6dbc4", background: "#fffdf8" }} />
                <Area isAnimationActive={false} type="monotone" dataKey="amount" stroke="#C97712" strokeWidth={2.5} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Sabse zyada udhaar</h2><Link to="/app/udhaar" className="text-sm font-semibold text-saffron-700">Sab dekhein <ArrowRight className="inline size-3.5" aria-hidden /></Link></div>
          <ul className="divide-y divide-cream-200">
            {udhaar.top.map((c) => (<li key={c.id} className="flex items-center justify-between py-2.5"><span className="font-medium">{c.name}</span><span className="font-display font-semibold">{inr(c.balance)}</span></li>))}
            {udhaar.top.length === 0 && <li className="py-6 text-center text-sm text-ink-500">Koi udhaar baaki nahi 🎉</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between"><Eyebrow>Evening brief</Eyebrow><Button size="sm" variant="soft" onClick={() => brief.mutate()} loading={brief.isPending}>{data.brief ? "Refresh" : "Generate now"}</Button></div>
          {data.brief ? (<><p className="font-display text-lg leading-snug">{data.brief.text}</p><p className="mt-2 text-xs text-ink-500">{data.brief.sent ? "WhatsApp par bheja gaya" : "Raat 10 baje WhatsApp par aayega"} · {data.brief.day}</p></>)
            : <p className="text-ink-500">Raat 10 baje Munshi din ka hisaab bhejega. Abhi dekhne ke liye “Generate now” dabayein.</p>}
        </Card>
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between"><Eyebrow>Working-capital loan</Eyebrow><SimBadge /></div>
          <p className="flex items-center gap-2 font-display text-3xl font-semibold"><Landmark className="size-6 text-saffron-700" aria-hidden />{inr(data.loan.amount)}</p>
          <p className="mt-1 text-sm text-ink-500">Aapki last 30 din ki Paytm sales ({compact(data.loan.basis_30d_sales)}) ke basis par pre-offer.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate(`/app/munshi?q=${encodeURIComponent("Mujhe stock ke liye loan chahiye")}&send=1`)}>Munshi se offer maangein</Button>
        </Card>
      </div>
      {data.lapsed_count > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <p className="flex items-center gap-2"><AlertTriangle className="size-5 text-saffron-600" aria-hidden /><span><b>{data.lapsed_count} regulars</b> ne 30+ din se dukaan nahi aaye.</span></p>
          <Button size="sm" variant="soft" onClick={() => navigate(`/app/munshi?q=${encodeURIComponent("Purane customers ko wapas bulane ka offer bhejo")}&send=1`)}>Wapas bulayein</Button>
        </Card>
      )}
    </div>
  );
}
