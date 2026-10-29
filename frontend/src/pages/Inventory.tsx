import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Package, Plus, Sparkles, Truck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge, Button, Card, Empty, ErrorNote, Eyebrow, Field, Input, Modal, PageHeader, PageLoader, Select } from "../components/ui";
import { api } from "../lib/api";
import { inr } from "../lib/format";
import type { ForecastLine, Product, Supplier } from "../lib/types";

type Filter = "all" | "low" | "festive";
interface Forecast { festival: { name: string; days_away: number }; groups: { supplier: Supplier; lines: ForecastLine[]; total: number }[] }
const blank = { name: "", category: "", unit: "pcs", stock: "0", reorder_level: "0", unit_cost: "0", price: "0", supplier_id: "" };

export default function Inventory() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const [form, setForm] = useState<typeof blank | null>(null);
  const products = useQuery({ queryKey: ["products"], queryFn: () => api.get<Product[]>("/products") });
  const forecast = useQuery({ queryKey: ["forecast"], queryFn: () => api.get<Forecast>("/inventory/forecast") });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/suppliers") });

  const add = useMutation({
    mutationFn: (f: typeof blank) => api.post("/products", { ...f, stock: +f.stock, reorder_level: +f.reorder_level, unit_cost: +f.unit_cost, price: +f.price, supplier_id: f.supplier_id ? +f.supplier_id : null }),
    onSuccess: () => { toast.success("Product jud gaya"); setForm(null); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); form && add.mutate(form); };

  if (products.isLoading) return <PageLoader />;
  if (products.error) return <ErrorNote error={products.error} />;
  const rows = (products.data ?? []).filter((p) => filter === "all" || (filter === "low" ? p.low : p.festive));
  const fc = forecast.data;
  const gap = fc?.groups.reduce((s, g) => s + g.lines.length, 0) ?? 0;

  return (
    <div>
      <PageHeader eyebrow="Khaali shelf = lost sale" title="Stock">
        <Button onClick={() => setForm({ ...blank })}><Plus className="size-4" aria-hidden />Naya product</Button>
      </PageHeader>

      {fc && gap > 0 && (
        <Card className="mb-6 overflow-hidden border-saffron-500/50">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-saffron-500/10 px-5 py-4">
            <div><Eyebrow>{fc.festival.name} forecast · {fc.festival.days_away} din baaki</Eyebrow>
              <p className="mt-1 font-display text-xl font-semibold">{gap} items pichhle {fc.festival.name} jaisi demand ke liye kam hain</p></div>
            <Button onClick={() => navigate(`/app/munshi?q=${encodeURIComponent("Stock check karo aur supplier ko order do")}&send=1`)}><Sparkles className="size-4" aria-hidden />Munshi se order karwayein</Button>
          </div>
          <div className="divide-y divide-cream-200">
            {fc.groups.map((g) => (
              <div key={g.supplier.id} className="px-5 py-3.5">
                <p className="flex items-center justify-between font-semibold"><span className="flex items-center gap-2"><Truck className="size-4 text-saffron-700" aria-hidden />{g.supplier.name}</span><span className="font-display text-lg">{inr(g.total)}</span></p>
                <p className="mt-1 text-sm text-ink-500">{g.lines.slice(0, 6).map((l) => `${l.name} ×${l.qty}`).join(" · ")}{g.lines.length > 6 ? ` · +${g.lines.length - 6} aur` : ""}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-4 flex gap-2 overflow-x-auto" role="group" aria-label="Filter">
        {([["all", "Sab"], ["low", "Kam stock"], ["festive", "Tyohaar items"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={clsx("rounded-full border px-4 py-1.5 text-sm font-semibold whitespace-nowrap", filter === k ? "border-navy-900 bg-navy-900 text-cream-50" : "border-cream-300 bg-cream-50 hover:bg-cream-200")}>{l}</button>
        ))}
      </div>

      <Card className="divide-y divide-cream-200">
        {rows.length === 0 && <Empty icon={<Package className="size-6" />} title="Koi product nahi">Naya product jodein ya filter badlein.</Empty>}
        {rows.map((p) => {
          const pct = Math.min(100, (p.stock / Math.max(p.reorder_level * 2, 1)) * 100);
          return (
            <div key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[1.6fr_1.2fr_auto_auto]" data-testid="product-row">
              <div className="min-w-0"><p className="truncate font-semibold">{p.name}</p><p className="text-xs text-ink-500">{p.category} · {inr(p.price)}/{p.unit}</p></div>
              <div className="order-last col-span-2 sm:order-none sm:col-span-1">
                <div className="h-2 overflow-hidden rounded-full bg-cream-200"><div className={clsx("h-full rounded-full", p.low ? "bg-bad" : "bg-good")} style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-xs text-ink-500">{p.stock} {p.unit} · reorder at {p.reorder_level}{p.incoming_qty > 0 && <span className="font-semibold text-good"> · +{p.incoming_qty} aa raha hai ({p.incoming_eta})</span>}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">{p.festive && <Badge tone="saffron">Tyohaar</Badge>}{p.low && <Badge tone="bad">Kam</Badge>}</div>
            </div>
          );
        })}
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title="Naya product">
        {form && (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Naam">{(id) => <Input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">{(id) => <Input id={id} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />}</Field>
              <Field label="Unit">{(id) => <Input id={id} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />}</Field>
              <Field label="Stock">{(id) => <Input id={id} type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />}</Field>
              <Field label="Reorder level">{(id) => <Input id={id} type="number" min={0} value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} />}</Field>
              <Field label="Cost (₹)">{(id) => <Input id={id} type="number" min={0} value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />}</Field>
              <Field label="Price (₹)">{(id) => <Input id={id} type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />}</Field>
            </div>
            <Field label="Supplier">{(id) => (
              <Select id={id} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">— koi nahi —</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>)}</Field>
            <Button type="submit" size="lg" className="w-full" loading={add.isPending}>Save karein</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
