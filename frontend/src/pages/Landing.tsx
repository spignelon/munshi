import { ArrowRight, Lightbulb, Lock, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Logo } from "../components/Logo";
import { Button, Card, Eyebrow } from "../components/ui";
import { useAuth } from "../lib/auth";

const timeline = [
  ["9:02 am", "Finds 12 items that sold 3× last Diwali and are running low"],
  ["9:05 am", "Calls Sharma Distributors, orders ₹46,000 of stock, gets ₹1,800 off"],
  ["11:30 am", "Reminds 41 udhaar customers with Paytm links; ₹9,400 back by lunch"],
  ["10:00 pm", "Evening brief: ₹18,400 sales today, stock arrives at 11 am"],
];
const how = [
  { icon: MessageCircle, t: "Listens", d: "Hinglish voice on the Soundbox or phone. Whisper speech models, noisy-shop ready." },
  { icon: Lightbulb, t: "Thinks", d: "An agent reads Paytm sales, udhaar and stock, then plans the steps." },
  { icon: Send, t: "Acts", d: "Phone calls, WhatsApp messages, Paytm UPI links and supplier orders." },
  { icon: Lock, t: "Checks", d: "No rupee moves until Raj says “haan”, with daily spending caps on top.", dark: true },
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
          <Eyebrow dark>Team MalaAI · Paytm Merchant Growth AI</Eyebrow>
          <h1 className="mt-4 max-w-4xl text-[2.6rem] leading-[1.05] font-semibold sm:text-7xl">Raj speaks.<br />Munshi gets it done.</h1>
          <p className="mt-6 max-w-2xl text-lg text-cream-200/85 sm:text-xl">
            The voice-first AI business partner that runs the back office of every Paytm merchant. It calls suppliers, collects udhaar, brings customers back and plans stock — and asks Raj before a single rupee moves.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button size="lg" onClick={tryDemo} loading={busy}>Try the live demo <ArrowRight className="size-5" aria-hidden /></Button>
            <Link to="/signup"><Button size="lg" variant="onDark">Create your shop</Button></Link>
          </div>
          <p className="mt-4 text-sm text-cream-200/60">Demo opens “Raj Kirana Store, Lajpat Nagar” with 90 days of Paytm sales, 41 udhaar customers and a Diwali around the corner.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Eyebrow>Chapter 2 · Where Raj’s money goes</Eyebrow>
        <h2 className="mt-2 max-w-3xl text-3xl font-semibold sm:text-4xl">Raj loses money in three quiet ways.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[["₹38,000", "Udhaar stuck", "Owed by 41 customers. Asking feels rude, so he waits, and the notebook grows."],
            ["₹22,000", "Sales lost to empty shelves", "Ghee and dry fruits ran out on the three busiest days of last Diwali."],
            ["60", "Regulars gone silent", "They stopped coming this year. Nobody noticed and nobody called them back."]].map(([n, t, d]) => (
            <Card key={t} className="p-6"><p className="font-display text-4xl font-semibold">{n}</p><p className="mt-2 font-bold">{t}</p><p className="mt-1 text-ink-500">{d}</p></Card>
          ))}
        </div>
      </section>

      <section className="bg-cream-200/60 py-16">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <Eyebrow>Chapter 7 · One sentence, four jobs done</Eyebrow>
          <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">At 9 am, Raj says one line to Munshi.</h2>
          <blockquote className="mt-6 rounded-r-2xl border-l-4 border-saffron-500 bg-cream-50 px-6 py-5 font-display text-xl italic sm:text-2xl">
            “Diwali aa rahi hai. Stock check karo, Sharma ji ko order do, aur udhaar wapas lao.”
          </blockquote>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {timeline.map(([t, d], i) => (
              <li key={t}><Card className={i === 3 ? "h-full border-navy-900 bg-navy-900 p-5 text-cream-50" : "h-full p-5"}>
                <p className={`text-xl font-bold ${i === 3 ? "text-saffron-500" : "text-saffron-700"}`}>{t}</p><p className="mt-2">{d}</p>
              </Card></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Eyebrow>Chapter 9 · How Munshi works</Eyebrow>
        <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Listen, think, act, and check with Raj.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {how.map(({ icon: Icon, t, d, dark }) => (
            <Card key={t} className={dark ? "border-navy-900 bg-navy-900 p-6 text-cream-50" : "p-6"}>
              <Icon className="size-6 text-saffron-500" aria-hidden /><p className="mt-3 font-display text-2xl font-semibold">{t}</p>
              <p className={`mt-2 text-sm ${dark ? "text-cream-200/80" : "text-ink-500"}`}>{d}</p>
            </Card>
          ))}
        </div>
        <p className="mt-6 max-w-3xl text-lg text-ink-500">The agent proposes; fixed rules approve. Every order and payment can be traced back to the moment Raj said yes.</p>
      </section>

      <footer className="bg-navy-900 px-5 py-14 text-center text-cream-50">
        <h2 className="mx-auto max-w-3xl text-3xl font-semibold sm:text-5xl">Raj gets his evenings back.</h2>
        <p className="mt-3 text-cream-200/75">Paytm gets 1.5 crore merchants who never leave.</p>
        <Button size="lg" className="mt-7" onClick={tryDemo} loading={busy}>Try the live demo</Button>
        <p className="mt-10 text-xs text-cream-200/50">Team MalaAI · Munshi. Outcomes shown are pilot targets from a demo dataset, not measured results.</p>
      </footer>
    </div>
  );
}
