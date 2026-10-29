import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MessageCircle, Plus, ScanLine, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, PageLoader } from "../components/ui";
import { api } from "../lib/api";
import { shrinkImage } from "../lib/audio";
import { inr, timeAgo } from "../lib/format";
import type { Customer, ScanEntry } from "../lib/types";

interface Draft { name: string; phone: string; amount: string; kind: "credit" | "payment"; note: string; customer_id?: number }
const blank: Draft = { name: "", phone: "", amount: "", kind: "credit", note: "" };

export default function Udhaar() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["udhaar"], queryFn: () => api.get<{ total: number; customers: Customer[] }>("/udhaar") });
  const all = useQuery({ queryKey: ["customers", "all"], queryFn: () => api.get<Customer[]>("/customers") });
  const [entry, setEntry] = useState<Draft | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [rows, setRows] = useState<ScanEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["udhaar"] }); qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const match = d.customer_id ?? all.data?.find((c) => c.name.toLowerCase() === d.name.trim().toLowerCase())?.id;
      return api.post("/udhaar/entries", { customer_id: match, name: d.name, phone: d.phone, amount: Number(d.amount), kind: d.kind, note: d.note });
    },
    onSuccess: () => { toast.success("Ledger update ho gaya"); setEntry(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remind = useMutation({
    mutationFn: (c: Customer) => api.post(`/udhaar/${c.id}/remind`),
    onSuccess: (_, c) => { toast.success(`${c.name} ko WhatsApp reminder bhej diya`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const doImport = useMutation({
    mutationFn: () => api.post<{ imported: number }>("/udhaar/import", { entries: rows.map((r) => ({ name: r.name, customer_id: r.customer_id ?? undefined, amount: r.amount, note: r.note, kind: "credit" })) }),
    onSuccess: (r) => { toast.success(`${r.imported} entries ledger mein jud gayi`); setScanOpen(false); setRows([]); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onFile = async (file?: File) => {
    if (!file) return;
    setScanOpen(true); setScanning(true); setScanErr(null); setRows([]);
    try {
      const f = new FormData();
      f.append("image", await shrinkImage(file), "ledger.jpg");
      setRows((await api.form<{ entries: ScanEntry[] }>("/udhaar/scan", f)).entries);
    } catch (e) { setScanErr(e); } finally { setScanning(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const edit = (i: number, patch: Partial<ScanEntry>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const submit = (e: FormEvent) => { e.preventDefault(); if (entry) save.mutate(entry); };

  if (list.isLoading) return <PageLoader />;
  if (list.error) return <ErrorNote error={list.error} />;
  const data = list.data!;

  return (
    <div>
      <PageHeader eyebrow="Lal copy, ab app mein" title="Udhaar ledger">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Upload ledger photo" data-testid="ledger-file" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="outline" onClick={() => fileRef.current?.click()}><Camera className="size-4" aria-hidden />Notebook photo scan</Button>
        <Button onClick={() => setEntry({ ...blank })}><Plus className="size-4" aria-hidden />Nayi entry</Button>
      </PageHeader>

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 border-navy-900 bg-navy-900 p-5 text-cream-50">
        <div><p className="text-sm text-cream-200/70">Kul baaki</p><p className="font-display text-4xl font-semibold" data-testid="udhaar-total">{inr(data.total)}</p></div>
        <p className="text-cream-200/80">{data.customers.length} customers se</p>
      </Card>

      <Card className="divide-y divide-cream-200">
        {data.customers.length === 0 && <Empty icon={<ScanLine className="size-6" />} title="Koi udhaar baaki nahi">Nayi entry jodein, ya apni lal copy ki photo scan karein.</Empty>}
        {data.customers.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5" data-testid="udhaar-row">
            <div className="min-w-0 flex-1 basis-40">
              <p className="truncate font-semibold">{c.name}</p>
              <p className="text-xs text-ink-500">{c.phone || "phone nahi"} · {c.last_reminded_at ? `reminder ${timeAgo(c.last_reminded_at)}` : "reminder nahi gaya"}</p>
            </div>
            <p className="font-display text-xl font-semibold">{inr(c.balance)}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="soft" onClick={() => remind.mutate(c)} loading={remind.isPending && remind.variables?.id === c.id} disabled={!c.phone}><MessageCircle className="size-4" aria-hidden />Remind</Button>
              <Button size="sm" variant="outline" onClick={() => setEntry({ ...blank, name: c.name, customer_id: c.id, kind: "payment", amount: String(c.balance) })}>Mila</Button>
            </div>
          </div>
        ))}
      </Card>

      <Modal open={!!entry} onClose={() => setEntry(null)} title={entry?.kind === "payment" ? "Payment mila" : "Nayi udhaar entry"}>
        {entry && (
          <form onSubmit={submit} className="space-y-4">
            <div role="group" aria-label="Entry type" className="grid grid-cols-2 gap-1 rounded-xl bg-cream-200 p-1">
              {([["credit", "Udhaar diya"], ["payment", "Paisa mila"]] as const).map(([k, l]) => (
                <button type="button" key={k} aria-pressed={entry.kind === k} onClick={() => setEntry({ ...entry, kind: k })}
                  className={`rounded-lg py-2 text-sm font-semibold ${entry.kind === k ? "bg-cream-50 shadow-sm" : "text-ink-500"}`}>{l}</button>
              ))}
            </div>
            <Field label="Customer ka naam">{(id) => (<>
              <Input id={id} list="cust-names" required value={entry.name} onChange={(e) => setEntry({ ...entry, name: e.target.value, customer_id: undefined })} placeholder="Gupta ji" />
              <datalist id="cust-names">{all.data?.map((c) => <option key={c.id} value={c.name} />)}</datalist></>)}</Field>
            <Field label="Amount (₹)">{(id) => <Input id={id} type="number" required min={1} step="any" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />}</Field>
            <Field label="Phone (naye customer ke liye)">{(id) => <Input id={id} type="tel" value={entry.phone} onChange={(e) => setEntry({ ...entry, phone: e.target.value })} placeholder="98765 43210" />}</Field>
            <Field label="Note">{(id) => <Input id={id} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} placeholder="atta, daal" />}</Field>
            <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Save karein</Button>
          </form>
        )}
      </Modal>

      <Modal open={scanOpen} onClose={() => setScanOpen(false)} title="Notebook se entries" wide>
        {scanning ? (
          <div className="grid place-items-center gap-3 py-12 text-ink-500" role="status"><ScanLine className="size-8 animate-pulse text-saffron-600" aria-hidden />Munshi aapki copy padh raha hai…</div>
        ) : scanErr ? <div className="space-y-3"><ErrorNote error={scanErr} /><Button variant="outline" onClick={() => fileRef.current?.click()}>Dusri photo try karein</Button></div>
        : rows.length === 0 ? <Empty title="Koi entry nahi mili">Saaf, seedhi photo lein jisme naam aur amount dikhein.</Empty> : (
          <div>
            <p className="mb-3 text-sm text-ink-500">Check karke theek karein, phir import dabayein. Jab tak aap import nahi karte, ledger nahi badlega.</p>
            <ul className="space-y-2">
              {rows.map((r, i) => (
                <li key={i} className="grid grid-cols-[1fr_6.5rem_auto] items-center gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]" data-testid="scan-row">
                  <Input aria-label={`Name ${i + 1}`} value={r.name} onChange={(e) => edit(i, { name: e.target.value, customer_id: null, matched: false })} />
                  <Input aria-label={`Amount ${i + 1}`} type="number" value={r.amount} onChange={(e) => edit(i, { amount: Number(e.target.value) })} />
                  <Input aria-label={`Note ${i + 1}`} className="col-span-2 sm:col-span-1" value={r.note} onChange={(e) => edit(i, { note: e.target.value })} placeholder="note" />
                  <div className="flex items-center gap-1.5">{r.matched && <Badge tone="good">purana</Badge>}
                    <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove row ${i + 1}`} className="rounded-lg p-2 text-ink-500 hover:bg-cream-200"><Trash2 className="size-4" /></button></div>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex items-center justify-between gap-3"><p className="text-sm font-semibold">{rows.length} entries · {inr(rows.reduce((s, r) => s + r.amount, 0))}</p>
              <Button onClick={() => doImport.mutate()} loading={doImport.isPending} disabled={!rows.length}>Ledger mein import karein</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
