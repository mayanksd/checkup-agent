// Shapes streamed from /api/agent to the page (NDJSON, one event per line).
import type { Plan, CoverageResult, PolicySummary } from "./planner.ts";
import type { Focus, ModeChoice } from "./guard.ts";

export interface StepEvent {
  type: "step";
  id: string;
  tool: string;
  status: "running" | "ok" | "warn" | "error";
  summary: string;
  ms?: number;
}
export interface NoteEvent { type: "note"; icon: string; text: string }

export interface ShortlistRow {
  providerId: string;
  name: string;
  product: string;
  covers: string;
  priceInr: number;
  priceLabel: string;
  priceSource: "live" | "listed";
  rating: number | null;
  reviews: number | null;
  ratingLabel: string;
  mapsUrl: string;
  mode: string;
  location: string;
  coverage: string;
}

export interface AgentResult {
  persona: { name: string; age: number | null };
  policy: Pick<PolicySummary, "sumInsured" | "limit" | "route" | "claimWithinDays" | "policyYearStart" | "geneticTests" | "ignoredLines">;
  focus: Focus[];
  mode: ModeChoice;
  shortlist: ShortlistRow[];
  plan: Plan;
  mapsUrls: Record<string, string>;
  ratingLabels: Record<string, string>;
  coverage: CoverageResult[];
  reminder: { remindOn: string; resetsOn: string; ics: string };
  notes: string[];
  driver: "agent" | "offline";
}

export interface ResultEvent { type: "result"; result: AgentResult }
export interface ErrorEvent { type: "error"; message: string }
export type AgentEvent = StepEvent | NoteEvent | ResultEvent | ErrorEvent;
