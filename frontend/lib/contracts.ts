export const REIN_FACTORY_ADDRESS = (process.env.NEXT_PUBLIC_REIN_FACTORY_ADDRESS ?? "") as `0x${string}`;

export function isValidAddress(addr: string): addr is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

export const FACTORY_NOT_CONFIGURED_MESSAGE =
  "No ReinFactory address is configured for this deployment yet. Set NEXT_PUBLIC_REIN_FACTORY_ADDRESS (see frontend/.env.local.example) after running the deploy script.";

export function isFactoryConfigured(): boolean {
  return isValidAddress(REIN_FACTORY_ADDRESS);
}

export interface ReinMeta {
  address: string;
  mandate: string;
  spend_cap: string;
  deadline: string;
  agent: string;
  principal: string;
  created_at: string;
}

export interface ReinStatus {
  principal: string;
  agent: string;
  mandate: string;
  spend_cap: string;
  remaining_cap: string;
  deadline_ts: string;
  created_at: string;
  kill_switch: boolean;
  threat_score: string;
  bond_amount: string;
  bond_funded: boolean;
  settled: boolean;
  last_verdict: string;
  last_reason: string;
  last_confidence: string;
  action_count: string;
}

export type Verdict = "IN_MANDATE" | "DRIFT" | "VIOLATION" | "PENDING";

export interface ReinAction {
  id: number;
  description: string;
  amount: number;
  evidence_urls: string[];
  verdict: Verdict;
  reason: string;
  confidence: string;
  recommended_remaining_cap: string;
  kill_switch: boolean;
  submitted_at: string;
  adjudicated_at: string;
}
