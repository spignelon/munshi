import { useMutation } from "@tanstack/react-query";
import { LogOut, Shield } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button, Card, Eyebrow, Field, Input, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { inr } from "../lib/format";

export default function SettingsPage() {
  const { session, refresh, logout, isAdmin } = useAuth();
  const s = session!.shop;
  const [f, setF] = useState({ name: s.name, locality: s.locality, upi_vpa: s.upi_vpa, whatsapp_number: s.whatsapp_number, per_order_cap: s.per_order_cap, daily_spend_cap: s.daily_spend_cap });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value });
  const save = useMutation({
    mutationFn: () => api.put("/shop", f),
    onSuccess: async () => { await refresh(); toast.success("Settings save ho gayi"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Aapki dukaan" title="Settings" />
      <form onSubmit={submit} className="space-y-6">
        <Card className="space-y-4 p-5 sm:p-6">
          <Eyebrow>Shop profile</Eyebrow>
          <Field label="Shop name">{(id) => <Input id={id} required value={f.name} onChange={set("name")} />}</Field>
          <Field label="Locality">{(id) => <Input id={id} value={f.locality} onChange={set("locality")} />}</Field>
          <Field label="UPI ID" hint="Udhaar reminders mein is UPI ID ka pay link jaata hai.">{(id) => <Input id={id} value={f.upi_vpa} onChange={set("upi_vpa")} placeholder="rajkirana@paytm" />}</Field>
          <Field label="Aapka WhatsApp number" hint="Isi number se aapki “haan” aur voice notes pehchani jaati hain.">{(id) => <Input id={id} type="tel" value={f.whatsapp_number} onChange={set("whatsapp_number")} placeholder="+91 98765 43210" />}</Field>
        </Card>
        <Card className="space-y-4 p-5 sm:p-6">
          <Eyebrow>Spending caps · Checks</Eyebrow>
          <p className="text-sm text-ink-500">Munshi in limits se zyada kabhi nahi kharch karega — chahe aap “haan” bhi bol dein. Abhi: {inr(f.per_order_cap)} per order, {inr(f.daily_spend_cap)} per din.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max per order (₹)">{(id) => <Input id={id} type="number" min={0} value={f.per_order_cap} onChange={set("per_order_cap")} />}</Field>
            <Field label="Daily spend cap (₹)">{(id) => <Input id={id} type="number" min={0} value={f.daily_spend_cap} onChange={set("daily_spend_cap")} />}</Field>
          </div>
        </Card>
        <Button type="submit" size="lg" loading={save.isPending}>Save karein</Button>
      </form>

      <Card className="mt-8 space-y-3 p-5 sm:p-6">
        <Eyebrow>Account</Eyebrow>
        <p className="text-sm"><b>{session!.user.name}</b> · {session!.user.email} · <span className="capitalize">{session!.user.role}</span></p>
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Link to="/app/admin"><Button variant="soft"><Shield className="size-4" aria-hidden />Admin console</Button></Link>}
          <Button variant="outline" onClick={() => logout(true)}><LogOut className="size-4" aria-hidden />Log out</Button>
        </div>
        {!isAdmin && <p className="text-xs text-ink-500">Mock mode aur Twilio / ElevenLabs keys sirf admin console mein badalti hain.</p>}
      </Card>
    </div>
  );
}
