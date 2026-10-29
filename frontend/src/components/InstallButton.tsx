import { Download } from "lucide-react";
import { toast } from "sonner";
import { useInstall } from "../lib/pwa";
import { Button } from "./ui";

/** Shows an "Install app" action when Chrome offers installation; nothing once installed. */
export function InstallButton({ className, variant = "soft" }: { className?: string; variant?: "soft" | "outline" | "onDark" }) {
  const { canInstall, install } = useInstall();
  if (!canInstall) return null;
  return (
    <Button variant={variant} size="sm" className={className} onClick={async () => { if (await install()) toast.success("Munshi install ho gaya!"); }}>
      <Download className="size-4" aria-hidden />Install app
    </Button>
  );
}
