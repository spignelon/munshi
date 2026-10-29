import { ArrowRight, BookOpen, Camera, Gift, Mic, PackageSearch, ShieldCheck, Truck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "../components/Logo";
import { Button, Card, Eyebrow } from "../components/ui";
import { useAuth } from "../lib/auth";

const features = [
  { icon: Mic, t: "Voice & text commands", d: "Speak or type in Hindi, Hinglish or English — in the app, as a WhatsApp voice note, or over a phone call." },
  { icon: Truck, t: "Restock from suppliers", d: "Spots low and festive-season items from last year's sales, then phones your supplier, asks for a discount and records the order." },
  { icon: BookOpen, t: "Collect udhaar", d: "Sends each customer their own balance on WhatsApp with a UPI / Paytm pay link, with a cooldown so nobody gets spammed." },
  { icon: Gift, t: "Win customers back", d: "Finds regulars who stopped visiting and sends them an offer you approve." },
  { icon: Camera, t: "Notebook to ledger", d: "Photograph the handwritten udhaar notebook. Munshi reads it, you review and edit, then import." },
  { icon: PackageSearch, t: "Daily summary & credit", d: "An end-of-day brief on WhatsApp, plus a working-capital loan pre-offer sized from your Paytm sales (simulated)." },
];
const steps = [
  ["Ask", "Tell Munshi what you need, by voice or text."],
  ["Review", "Munshi reads your sales, udhaar and stock and proposes a plan with exact amounts."],
  ["Approve", "Tick the actions you want and say yes. Nothing that moves money runs without it."],
  ["Done & logged", "Munshi makes the calls and messages, and every step is traced back to your approval."],
];

export default function Landing() {
  const { session, demo } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const tryDemo = async () => {
    setBusy(true);
    try { await demo(); navigate("/app"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="bg-cream-100">
      <section className="relative overflow-hidden bg-navy-900 text-cream-50">
        <div className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-saffron-500/15 blur-3xl" aria-hidden />
        <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Logo dark />
          <nav className="flex items-center gap-2">
            {session ? <Link to="/app" className="rounded-xl bg-saffron-500 px-4 py-2 text-sm font-semibold text-navy-900">Open app</Link> : (<>
              <Link to="/login" className="rounded-xl px-4 py-2 text-sm font-semibold text-cream-200 hover:bg-navy-800">Log in</Link>
              <Link to="/signup" className="hidden rounded-xl border border-cream-200/30 px-4 py-2 text-sm font-semibold hover:bg-navy-800 sm:block">Sign up</Link>
            </>)}
          </nav>
        </header>
        <div className="relative mx-auto max-w-6xl px-5 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28">
          <Eyebrow dark>AI assistant for Paytm merchants</Eyebrow>
          <h1 className="mt-4 max-w-4xl text-[2.6rem] leading-[1.05] font-semibold sm:text-7xl">Your shop’s back office, on voice.</h1>
          <p className="mt-6 max-w-2xl text-lg text-cream-200/85 sm:text-xl">
            Munshi handles the routine work behind a kirana store — reordering stock, collecting udhaar, bringing back lapsed customers — from one instruction. You approve before any money moves.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button size="lg" onClick={tryDemo} loading={busy}>Try the live demo <ArrowRight className="size-5" aria-hidden /></Button>
            <Link to="/signup"><Button size="lg" variant="onDark">Create your shop</Button></Link>
          </div>
          <p className="mt-4 text-sm text-cream-200/60">No signup needed for the demo: it opens a sample store with 90 days of Paytm sales, an udhaar ledger, stock and suppliers.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Eyebrow>What Munshi handles</Eyebrow>
        <h2 className="mt-2 max-w-3xl text-3xl font-semibold sm:text-4xl">The back-office jobs a shop owner does between customers.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, t, d }) => (
            <Card key={t} className="p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-saffron-500/15 text-saffron-700"><Icon className="size-5" aria-hidden /></span>
              <p className="mt-4 font-display text-xl font-semibold">{t}</p>
              <p className="mt-1.5 text-sm text-ink-500">{d}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="bg-cream-200/60 py-16">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">You stay in control of every rupee.</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([t, d], i) => (
              <li key={t}><Card className={i === 2 ? "h-full border-navy-900 bg-navy-900 p-5 text-cream-50" : "h-full p-5"}>
                <p className={`text-sm font-bold ${i === 2 ? "text-saffron-500" : "text-saffron-700"}`}>Step {i + 1}</p>
                <p className="mt-1 font-display text-xl font-semibold">{t}</p>
                <p className={`mt-2 text-sm ${i === 2 ? "text-cream-200/80" : "text-ink-500"}`}>{d}</p>
              </Card></li>
            ))}
          </ol>
          <Card className="mt-6 flex items-start gap-3 p-5">
            <ShieldCheck className="mt-0.5 size-6 shrink-0 text-good" aria-hidden />
            <p className="text-ink-500"><b className="text-navy-900">Built-in checks.</b> Per-order and daily spending caps are enforced again at execution, every action links to the approval that authorised it, and a full audit log is kept. The AI proposes; fixed rules decide.</p>
          </Card>
        </div>
      </section>

      <footer className="bg-navy-900 px-5 py-14 text-center text-cream-50">
        <h2 className="mx-auto max-w-3xl text-3xl font-semibold sm:text-5xl">Run your shop’s back office by voice.</h2>
        <Button size="lg" className="mt-7" onClick={tryDemo} loading={busy}>Try the live demo</Button>
        <p className="mt-10 text-xs text-cream-200/50">Munshi · AI business assistant for kirana merchants</p>
      </footer>
    </div>
  );
}
