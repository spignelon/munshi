import clsx from "clsx";
import { BookOpen, History, LayoutDashboard, LogOut, Menu, Mic, Package, Settings, Shield, Truck, Users, FlaskConical } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Logo } from "./Logo";
import { Modal } from "./ui";

const nav = [
  { to: "/app", label: "Home", icon: LayoutDashboard, end: true },
  { to: "/app/munshi", label: "Munshi", icon: Mic },
  { to: "/app/activity", label: "Activity", icon: History },
  { to: "/app/udhaar", label: "Udhaar", icon: BookOpen },
  { to: "/app/stock", label: "Stock", icon: Package },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/suppliers", label: "Suppliers", icon: Truck },
  { to: "/app/settings", label: "Settings", icon: Settings },
];
const tabs = ["/app", "/app/munshi", "/app/udhaar", "/app/stock"];

export function Shell() {
  const { session, isAdmin, logout } = useAuth();
  const [more, setMore] = useState(false);
  const items = isAdmin ? [...nav, { to: "/app/admin", label: "Admin", icon: Shield }] : nav;
  const out = () => logout(true);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col bg-navy-900 p-5 text-cream-100 lg:flex">
        <Logo dark className="mb-8 px-1" />
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => clsx("flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-medium transition-colors",
                isActive ? "bg-saffron-500 text-navy-900" : "text-cream-200/80 hover:bg-navy-800 hover:text-cream-50")}>
              <Icon className="size-[18px]" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl bg-navy-800 p-3.5">
          <p className="truncate text-sm font-semibold text-cream-50">{session?.shop.name}</p>
          <p className="truncate text-xs text-cream-200/60">{session?.user.email}</p>
          <button onClick={out} className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-cream-200/80 hover:bg-navy-700 hover:text-cream-50">
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {session?.mock_mode && (
          <div className="flex items-center justify-center gap-2 bg-violet-100 px-3 py-1.5 text-center text-xs font-medium text-violet-800" data-testid="mock-banner">
            <FlaskConical className="size-3.5 shrink-0" aria-hidden />
            Mock mode is ON — calls, WhatsApp and payments are simulated.
            {isAdmin && <NavLink to="/app/admin" className="font-bold underline">Change</NavLink>}
          </div>
        )}
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-cream-300/70 bg-cream-100/90 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <p className="max-w-[45%] truncate text-sm font-medium text-ink-500">{session?.shop.name}</p>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 sm:pt-8 lg:pb-12"><Outlet /></main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-cream-300 bg-cream-50/95 backdrop-blur lg:hidden" aria-label="Primary">
        {nav.filter((n) => tabs.includes(n.to)).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => clsx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", isActive ? "text-saffron-700" : "text-ink-500")}>
            {({ isActive }) => (<>
              <span className={clsx("grid h-7 w-12 place-items-center rounded-full", isActive && "bg-saffron-500/20")}><Icon className="size-5" aria-hidden /></span>{label}
            </>)}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-ink-500" aria-label="More">
          <span className="grid h-7 w-12 place-items-center"><Menu className="size-5" aria-hidden /></span>More
        </button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="grid gap-1">
          {items.filter((n) => !tabs.includes(n.to)).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setMore(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 font-medium hover:bg-cream-200">
              <Icon className="size-5 text-saffron-700" aria-hidden /> {label}
            </NavLink>
          ))}
          <button onClick={out} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left font-medium text-bad hover:bg-cream-200"><LogOut className="size-5" aria-hidden /> Log out</button>
        </div>
      </Modal>
    </div>
  );
}
