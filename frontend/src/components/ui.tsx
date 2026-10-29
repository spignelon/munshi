import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type Variant = "primary" | "dark" | "outline" | "onDark" | "ghost" | "danger" | "soft";
const variants: Record<Variant, string> = {
  primary: "bg-saffron-500 text-navy-900 hover:bg-saffron-400 shadow-sm shadow-saffron-600/20",
  dark: "bg-navy-900 text-cream-50 hover:bg-navy-800",
  outline: "border border-cream-300 bg-cream-50 text-navy-900 hover:bg-cream-200",
  onDark: "border border-cream-200/35 text-cream-50 hover:bg-navy-800",
  ghost: "text-navy-900 hover:bg-cream-200",
  danger: "bg-bad text-white hover:bg-red-700",
  soft: "bg-saffron-500/12 text-saffron-700 hover:bg-saffron-500/20",
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 select-none",
        size === "sm" ? "px-3 py-1.5 text-sm" : size === "lg" ? "px-6 py-3.5 text-base" : "px-4 py-2.5 text-sm",
        variants[variant], className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export const Card = ({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={clsx("rounded-2xl border border-cream-300/70 bg-cream-50 shadow-[0_1px_2px_rgba(17,27,51,0.04)]", className)}>{children}</div>
);

export const Eyebrow = ({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) => (
  <p className={clsx("text-[11px] font-bold uppercase tracking-[0.14em]", dark ? "text-saffron-500" : "text-saffron-700", className)}>{children}</p>
);

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="text-[1.75rem] font-semibold leading-tight sm:text-3xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const tones = {
  neutral: "bg-cream-200 text-navy-600",
  saffron: "bg-saffron-500/15 text-saffron-700",
  good: "bg-good/12 text-good",
  bad: "bg-bad/10 text-bad",
  navy: "bg-navy-900 text-cream-50",
  sim: "bg-violet-100 text-violet-700",
};
export const Badge = ({ tone = "neutral", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) => (
  <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>
);
export const SimBadge = () => <Badge tone="sim" className="uppercase tracking-wide text-[10px]">Simulated</Badge>;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin text-saffron-600", className ?? "size-5")} aria-label="Loading" />;
}
export const PageLoader = () => <div className="grid place-items-center py-24" role="status"><Spinner className="size-7" /></div>;

export const Empty = ({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) => (
  <div className="grid place-items-center gap-2 px-6 py-14 text-center">
    {icon && <div className="grid size-12 place-items-center rounded-2xl bg-cream-200 text-saffron-700">{icon}</div>}
    <p className="font-display text-lg font-semibold">{title}</p>
    {children && <div className="max-w-sm text-sm text-ink-500">{children}</div>}
  </div>
);

export const ErrorNote = ({ error }: { error: unknown }) => (
  <div role="alert" className="rounded-xl border border-bad/25 bg-bad/8 px-4 py-3 text-sm text-bad">{error instanceof Error ? error.message : String(error)}</div>
);

const fieldCls = "w-full rounded-xl border border-cream-300 bg-white px-3.5 py-2.5 text-[15px] text-navy-900 placeholder:text-ink-400 transition focus:border-saffron-500 focus:outline-none focus:ring-2 focus:ring-saffron-500/25 disabled:bg-cream-100 disabled:text-ink-400";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">{label}</label>
      {children(id)}
      {hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx(fieldCls, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx(fieldCls, "min-h-24", className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={clsx(fieldCls, "appearance-auto", className)} />;

export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={clsx("relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-saffron-500" : "bg-cream-300")}
    >
      <span className={clsx("absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid items-end bg-navy-950/55 backdrop-blur-[2px] sm:place-items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={clsx("max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-cream-50 p-5 shadow-2xl sm:rounded-3xl sm:p-6", wide ? "sm:max-w-2xl" : "sm:max-w-md")}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-500 hover:bg-cream-200"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "highlight" }) {
  return (
    <Card className={clsx("p-4 sm:p-5", tone === "highlight" && "border-saffron-500 bg-saffron-500")}>
      <div className="flex items-start justify-between gap-2">
        <p className={clsx("text-sm", tone === "highlight" ? "text-navy-900/80" : "text-ink-500")}>{label}</p>
        {icon && <span className={clsx("shrink-0", tone === "highlight" ? "text-navy-900/70" : "text-saffron-600")}>{icon}</span>}
      </div>
      <p className="mt-1.5 font-display text-[1.65rem] leading-none font-semibold sm:text-[2rem]">{value}</p>
      {sub && <p className={clsx("mt-2 text-xs", tone === "highlight" ? "text-navy-900/75" : "text-ink-500")}>{sub}</p>}
    </Card>
  );
}
