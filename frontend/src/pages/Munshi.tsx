import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { VoiceMode } from "../components/VoiceMode";

/** Munshi is voice-first: this page *is* the hands-free voice screen (no chat view). `?q=…&send=1` sends a prepared message as the first turn. */
export default function Munshi() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialText = params.get("send") === "1" ? params.get("q") ?? undefined : undefined;
  const close = useCallback(() => navigate("/app"), [navigate]);
  return <VoiceMode onClose={close} initialText={initialText} />;
}
