import { Check, Database, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "../components/Logo";
import { Button, Card, ErrorNote, Eyebrow, Field, Input } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Onboarding() {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const shop = session!.shop;
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    name: shop.name, locality: shop.locality, upi_vpa: shop.upi_vpa, whatsapp_number: shop.whatsapp_number,
    per_order_cap: shop.per_order_cap, daily_spend_cap: shop.daily_spend_cap,
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });

  const saveShop = async () => {
    setErr(null); setBusy("save");
    try { await api.put("/shop", f); setStep(1); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const finish = async (withDemo: boolean) => {
    setErr(null); setBusy(withDemo ? "demo" : "empty");
    try {
      if (withDemo) await api.post("/shop/demo-data");
      await api.put("/shop", { onboarded: true });
      await refresh();
      toast.success(withDemo ? "Demo dukaan taiyaar hai!" : "Aapki dukaan taiyaar hai!");
      navigate("/app", { replace: true });
    } catch (e) { setErr(e); setBusy(null); }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-cream-100 px-4 py-10">
      <div className="w-full max-w-lg">
        <Logo className="mb-8" />
        <ol className="mb-6 flex gap-2" aria-label="Progress">
          {["Shop", "Data"].map((s, i) => (
            <li key={s} className={`flex flex-1 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${i <= step ? "bg-saffron-500 text-navy-900" : "bg-cream-200 text-ink-500"}`}>
              {i < step ? <Check className="size-4" aria-hidden /> : <span className="grid size-5 place-items-center rounded-full bg-navy-900/10 text-xs">{i + 1}</span>}{s}
            </li>
          ))}
        </ol>
        {step === 0 ? (
          <Card className="p-6">
            <Eyebrow>Step 1 · Aapki dukaan</Eyebrow>
            <h1 className="mt-1 text-2xl font-semibold">Munshi ko dukaan ke baare mein batayein</h1>
            <div className="mt-5 space-y-4">
              <Field label="Shop name">{(id) => <Input id={id} value={f.name} onChange={set("name")} />}</Field>
              <Field label="Locality">{(id) => <Input id={id} value={f.locality} onChange={set("locality")} placeholder="Lajpat Nagar, Delhi" />}</Field>
              <Field label="UPI ID" hint="Udhaar reminders carry a pay link to this UPI ID.">{(id) => <Input id={id} value={f.upi_vpa} onChange={set("upi_vpa")} placeholder="rajkirana@paytm" />}</Field>
              <Field label="Your WhatsApp number" hint="Munshi takes your “haan” and sends your evening brief here.">{(id) => <Input id={id} type="tel" value={f.whatsapp_number} onChange={set("whatsapp_number")} placeholder="+91 98765 43210" />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Max per order (₹)" hint="Bigger supplier orders are blocked.">{(id) => <Input id={id} type="number" min={0} value={f.per_order_cap} onChange={set("per_order_cap")} />}</Field>
                <Field label="Daily spend cap (₹)" hint="Total Munshi may order per day.">{(id) => <Input id={id} type="number" min={0} value={f.daily_spend_cap} onChange={set("daily_spend_cap")} />}</Field>
              </div>
            </div>
            {err != null && <div className="mt-4"><ErrorNote error={err} /></div>}
            <Button size="lg" className="mt-6 w-full" onClick={saveShop} loading={busy === "save"}>Aage badhein</Button>
          </Card>
        ) : (
          <Card className="p-6">
            <Eyebrow>Step 2 · Data</Eyebrow>
            <h1 className="mt-1 text-2xl font-semibold">Kaise shuru karna chahenge?</h1>
            <div className="mt-5 grid gap-3">
              <button onClick={() => finish(true)} disabled={!!busy} className="rounded-2xl border-2 border-saffron-500 bg-saffron-500/10 p-4 text-left transition hover:bg-saffron-500/15 disabled:opacity-60">
                <span className="flex items-center gap-2 font-display text-lg font-semibold"><Sparkles className="size-5 text-saffron-700" aria-hidden />Demo data se shuru karein {busy === "demo" && "…"}</span>
                <span className="mt-1 block text-sm text-ink-500">90 din ki Paytm sales, 41 udhaar customers (₹38,000), 40 products, 5 suppliers aur Diwali ki tayyari. Munshi ko turant try karein.</span>
              </button>
              <button onClick={() => finish(false)} disabled={!!busy} className="rounded-2xl border border-cream-300 bg-white p-4 text-left transition hover:bg-cream-100 disabled:opacity-60">
                <span className="flex items-center gap-2 font-display text-lg font-semibold"><Database className="size-5 text-ink-500" aria-hidden />Khaali dukaan {busy === "empty" && "…"}</span>
                <span className="mt-1 block text-sm text-ink-500">Apna ledger, stock aur suppliers khud add karein.</span>
              </button>
            </div>
            {err != null && <div className="mt-4"><ErrorNote error={err} /></div>}
          </Card>
        )}
      </div>
    </div>
  );
}
