import clsx from "clsx";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={clsx("size-9", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#E8912D" />
      <path d="M16 46V18h6l10 17 10-17h6v28h-6V29L32 46 22 29v17z" fill="#111B33" />
    </svg>
  );
}

export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={clsx("font-display text-2xl font-semibold tracking-tight", dark ? "text-cream-50" : "text-navy-900")}>Munshi</span>
    </span>
  );
}
