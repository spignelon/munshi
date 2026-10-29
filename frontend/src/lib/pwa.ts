import { useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// beforeinstallprompt fires once, early. Capture it at module load so components mounting later still get it.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let snapshot = { canInstall: false, installed };
const refresh = () => { snapshot = { canInstall: !!deferred && !installed, installed }; emit(); };

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; refresh(); });
  window.addEventListener("appinstalled", () => { installed = true; deferred = null; refresh(); });
  refresh();
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  refresh();
  return outcome === "accepted";
}

export function useInstall() {
  const s = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => snapshot, () => snapshot);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
  return { ...s, ios, install: promptInstall };
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return; // dev server uses HMR; a SW would cache stale modules
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* app works without it */ }); });
}
