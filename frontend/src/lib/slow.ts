import { toast } from "sonner";

/** Shows a "server is waking up" toast if a request takes longer than `ms`, so a slow first call never looks frozen. */
export async function withSlowHint<T>(p: Promise<T>, ms = 4000): Promise<T> {
  const timer = setTimeout(() => toast.loading("Server wake ho raha hai… thoda intezaar karein (pehli request mein kuch second lagte hain)", { id: "slow-hint", duration: 60000 }), ms);
  try { return await p; } finally { clearTimeout(timer); toast.dismiss("slow-hint"); }
}
