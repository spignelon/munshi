export type Role = "merchant" | "admin";
export interface User { id: number; email: string; name: string; phone: string; role: Role }
export interface Shop {
  id: number; name: string; locality: string; upi_vpa: string; whatsapp_number: string; language: string;
  daily_spend_cap: number; per_order_cap: number; onboarded: boolean; demo_loaded: boolean;
}
export interface Session { user: User; shop: Shop; mock_mode: boolean }

export type ActionType = "supplier_order" | "udhaar_reminders" | "winback_offer" | "loan_offer" | "stock_report" | "ledger_import";
export type ActionStatus = "proposed" | "approved" | "executing" | "done" | "failed" | "rejected" | "blocked";
export interface Action {
  id: number; plan_id: number; type: ActionType; title: string; detail: string; amount: number; status: ActionStatus;
  blocked_reason: string; result: Record<string, any>; simulated: boolean; payload: Record<string, any>;
  created_at: string; finished_at: string | null;
}
export interface Approval { id: number; decision: "approved" | "rejected"; channel: string; utterance: string; created_at: string; action_ids: number[] }
export interface CallSession {
  id: number; action_id: number; counterpart: string; phone: string; status: string; simulated: boolean;
  transcript: { speaker: string; text: string }[]; outcome: Record<string, any>; created_at: string;
}
export interface OutMessage {
  id: number; action_id: number; channel: string; to: string; recipient_name: string; body: string; status: string;
  simulated: boolean; error: string; created_at: string;
}
export interface Plan {
  id: number; utterance: string; channel: string; summary: string;
  status: "proposed" | "approved" | "rejected" | "executed" | "partial" | "failed" | "blocked"; created_at: string;
  actions: Action[]; approvals: Approval[]; calls?: CallSession[]; messages?: OutMessage[];
}
export interface CommandResult { transcript: string; voice: boolean; reply: string; decision: "approved" | "rejected" | null; plan: Plan | null }
export interface ChatMessage { id: number; role: "user" | "munshi"; text: string; channel: string; plan_id: number | null; created_at: string }

export interface Customer { id: number; name: string; phone: string; last_visit: string | null; visits: number; lifetime_spend: number; balance: number; last_reminded_at: string | null }
export interface Product {
  id: number; name: string; category: string; unit: string; stock: number; reorder_level: number; unit_cost: number; price: number;
  supplier_id: number | null; avg_daily_units: number; last_festival_units: number; incoming_qty: number; incoming_eta: string; festive: boolean; low: boolean;
}
export interface Supplier { id: number; name: string; phone: string; categories: string; notes: string }
export interface ForecastLine { product_id: number; name: string; unit: string; qty: number; unit_cost: number; stock: number; last_festival_units: number; multiple: number }

export interface Dashboard {
  shop: Shop;
  festival: { name: string; date: string; days_away: number };
  sales: { today: number; today_payments: number; yesterday: number; avg_7d: number; total_30d: number; series: { day: string; amount: number }[] };
  udhaar: { total: number; count: number; top: { id: number; name: string; balance: number }[] };
  stock: { low_count: number; festive_low_count: number; festive_order_total: number; festive_supplier: string | null };
  lapsed_count: number;
  pending_plans: Plan[];
  brief: { text: string; day: string; stats: Record<string, number>; sent: boolean } | null;
  loan: { amount: number; tenure_months: number; basis_30d_sales: number; note: string };
  groq: { configured: boolean };
}

export interface AdminSettings {
  settings: {
    mock_mode: boolean; stt_provider: "sarvam" | "groq"; tts_provider: "sarvam" | "edge" | "elevenlabs"; edge_voice: string;
    sarvam_api_key: string; sarvam_api_key_set: boolean; sarvam_speaker: string; sarvam_budget_inr: string;
    elevenlabs_api_key: string; elevenlabs_api_key_set: boolean; elevenlabs_voice_id: string; elevenlabs_model: string;
    twilio_account_sid: string; twilio_auth_token: string; twilio_auth_token_set: boolean; twilio_voice_number: string;
    twilio_whatsapp_from: string; test_redirect_number: string; reminder_channel: "whatsapp" | "call" | "both";
    twilio_whatsapp_content_sid: string; twilio_whatsapp_content_vars: string;
  };
  edge_voices: string[];
  sarvam_speakers: { id: string; label: string }[];
  sarvam_usage: SarvamUsage;
  webhooks: { base: string; whatsapp: string; voice_inbound: string };
}
export interface SarvamUsage { stt_minutes: number; tts_chars: number; est_spend_inr: number; budget_inr: number }
export interface AdminStatus {
  db: { kind: string; persistent: boolean };
  groq: { configured: boolean; fake: boolean; models: Record<string, string>; usage: Record<string, Record<string, any>> };
  twilio: { configured: boolean; voice_number: string; whatsapp_from: string };
  elevenlabs: { configured: boolean };
  sarvam: { configured: boolean; available: boolean; stt_provider: string; tts_provider: string; usage: SarvamUsage };
  mock_mode: boolean;
  counts: Record<string, number>;
}
export interface AuditEntry { id: number; actor: string; event: string; ref: string; detail: Record<string, any>; created_at: string }
export interface ScanEntry { name: string; customer_id: number | null; amount: number; note: string; matched: boolean }
