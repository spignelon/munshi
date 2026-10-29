const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const inr = (n: number | null | undefined) => `₹${inr0.format(Math.round(n ?? 0))}`;
export const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : inr(n));

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "abhi";
  if (s < 3600) return `${Math.floor(s / 60)} min pehle`;
  if (s < 86400) return `${Math.floor(s / 3600)} ghante pehle`;
  return `${Math.floor(s / 86400)} din pehle`;
}
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
export const shortDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);
}
export const firstName = (n: string) => n.split(" ")[0];
