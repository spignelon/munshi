import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "../components/Logo";
import { Button, Eyebrow, ErrorNote, Field, Input } from "../components/ui";
import { useAuth } from "../lib/auth";

function AuthLayout({ title, sub, children, footer }: { title: string; sub: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-navy-900 p-12 text-cream-50 lg:flex">
        <Link to="/"><Logo dark /></Link>
        <div>
          <Eyebrow dark>AI assistant for Paytm merchants</Eyebrow>
          <p className="mt-4 font-display text-4xl leading-tight font-semibold">Your shop’s back office, on voice.</p>
          <ul className="mt-6 space-y-2.5 text-cream-200/80">
            {["Reorder stock from suppliers by phone", "Collect udhaar with WhatsApp + UPI pay links", "Win back customers who stopped visiting", "Approve everything before money moves"].map((t) => (
              <li key={t} className="flex items-start gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-saffron-500" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-cream-200/40">Munshi · AI business assistant for kirana merchants</p>
      </aside>
      <main className="grid place-items-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-8 block lg:hidden"><Logo /></Link>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="mt-1.5 mb-6 text-ink-500">{sub}</p>
          {children}
          <div className="mt-6 text-center text-sm text-ink-500">{footer}</div>
        </div>
      </main>
    </div>
  );
}

export function Login() {
  const { login, demo } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from || "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<"login" | "demo" | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy("login");
    try { await login(email, password); navigate(from, { replace: true }); } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  const tryDemo = async () => {
    setBusy("demo");
    try { await demo(); navigate("/app"); } catch (x) { toast.error((x as Error).message); } finally { setBusy(null); }
  };
  return (
    <AuthLayout title="Welcome back" sub="Log in to your Munshi dashboard." footer={<>New here? <Link to="/signup" className="font-bold text-saffron-700 underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {err != null && <ErrorNote error={err} />}
        <Button type="submit" size="lg" className="w-full" loading={busy === "login"}>Log in</Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-ink-400"><span className="h-px flex-1 bg-cream-300" />or<span className="h-px flex-1 bg-cream-300" /></div>
      <Button variant="dark" size="lg" className="w-full" onClick={tryDemo} loading={busy === "demo"}>Try the demo</Button>
    </AuthLayout>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: "", shop_name: "", email: "", phone: "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await signup(f); navigate("/onboarding", { replace: true }); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Apni dukaan shuru karein" sub="Create your Munshi account in a minute." footer={<>Already have an account? <Link to="/login" className="font-bold text-saffron-700 underline">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">{(id) => <Input id={id} required autoComplete="name" value={f.name} onChange={set("name")} placeholder="Your name" />}</Field>
        <Field label="Shop name">{(id) => <Input id={id} value={f.shop_name} onChange={set("shop_name")} placeholder="Your shop name" />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" required autoComplete="email" value={f.email} onChange={set("email")} />}</Field>
        <Field label="WhatsApp number" hint="Munshi sends your evening brief and takes your “haan” here.">{(id) => <Input id={id} type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="98765 43210" />}</Field>
        <Field label="Password" hint="At least 8 characters.">{(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set("password")} />}</Field>
        {err != null && <ErrorNote error={err} />}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Create account</Button>
      </form>
    </AuthLayout>
  );
}
