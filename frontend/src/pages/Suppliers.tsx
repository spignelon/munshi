import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Phone, Plus, Truck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, PageLoader } from "../components/ui";
import { api } from "../lib/api";
import type { Supplier } from "../lib/types";

type Form = Omit<Supplier, "id"> & { id?: number };
const blank: Form = { name: "", phone: "", categories: "", notes: "" };

export default function Suppliers() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<Supplier[]>("/suppliers") });
  const save = useMutation({
    mutationFn: (f: Form) => (f.id ? api.put(`/suppliers/${f.id}`, f) : api.post("/suppliers", f)),
    onSuccess: () => { toast.success("Supplier save ho gaya"); setForm(null); qc.invalidateQueries({ queryKey: ["suppliers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); form && save.mutate(form); };

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorNote error={error} />;
  return (
    <div>
      <PageHeader eyebrow="Jinhe Munshi phone karta hai" title="Suppliers"><Button onClick={() => setForm({ ...blank })}><Plus className="size-4" aria-hidden />Naya supplier</Button></PageHeader>
      {data?.length === 0 ? <Card><Empty icon={<Truck className="size-6" />} title="Koi supplier nahi">Supplier jodein, taaki Munshi unhe order de sake.</Empty></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((s) => (
            <Card key={s.id} className="p-5" data-testid="supplier-card">
              <div className="flex items-start justify-between gap-2"><p className="font-display text-xl font-semibold">{s.name}</p>
                <button onClick={() => setForm(s)} aria-label={`Edit ${s.name}`} className="rounded-lg p-1.5 text-ink-500 hover:bg-cream-200"><Pencil className="size-4" /></button></div>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500"><Phone className="size-3.5" aria-hidden />{s.phone || "phone nahi"}</p>
              <p className="mt-3 text-sm">{s.categories || "—"}</p>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Supplier badlein" : "Naya supplier"}>
        {form && (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Naam">{(id) => <Input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <Field label="Phone" hint="Munshi isi number par order call karega.">{(id) => <Input id={id} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98xxx xxxxx" />}</Field>
            <Field label="Kya bechte hain">{(id) => <Input id={id} value={form.categories} onChange={(e) => setForm({ ...form, categories: e.target.value })} placeholder="ghee, dry fruits" />}</Field>
            <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Save karein</Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
