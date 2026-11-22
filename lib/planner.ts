// Deterministic money maths, coverage and ranking. The model never does any of this.
import { policies, type PersonaId, type Policy } from "../data/policies.ts";
import { providers, providerById, PRICES_AS_OF_LABEL, type Provider, type Mode } from "../data/providers.ts";
import { sanitizePolicyText, checkupLimitFor, type Focus, type ModeChoice, type Profile } from "./guard.ts";

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const FOCUS_LABEL: Record<Focus, string> = {
  longevity: "Longevity",
  fullbody: "Full-body scan",
  genetic: "Genetic",
  gut: "Gut microbiome",
  stamina: "Stamina",
  heart: "Heart",
  metabolism: "Sugar & metabolism",
  hormones: "Hormones",
  thyroid: "Thyroid",
  bone: "Bone density",
  vitamins: "Vitamins",
  general: "General",
};

export const modeAllows = (choice: ModeChoice, mode: Mode) =>
  choice === "either" || (choice === "home" ? mode === "home collection" : mode === "lab visit");

// ---------- 1. getPolicy ----------
export interface PolicySummary {
  personaId: PersonaId;
  name: string;
  age: number | null;
  sumInsured: number;
  limit: number;
  route: string;
  claimWithinDays: number;
  policyYearStart: string;
  geneticTests: string;
  rules: string[];
  ignoredLines: number;
}

export function getPolicy(personaId: PersonaId, opts: { sumInsured?: number; profile?: Profile } = {}): PolicySummary {
  const p: Policy = policies[personaId];
  const { rules, ignored } = sanitizePolicyText(p.policyText);
  const sumInsured = opts.sumInsured ?? p.sumInsured;
  const custom = personaId === "custom" ? opts.profile : undefined;
  return {
    personaId,
    name: custom?.name || p.name,
    age: custom ? custom.age ?? null : p.age,
    sumInsured,
    // always from structured data (validated sum insured × 1%), never from policyText
    limit: checkupLimitFor(sumInsured),
    route: p.claimRoute,
    claimWithinDays: p.claimWithinDays,
    policyYearStart: p.policyYearStart,
    geneticTests: p.geneticTests,
    rules,
    ignoredLines: ignored,
  };
}

// ---------- 2. searchProviders ----------
const focusHits = (p: Provider, focus: Focus[]) =>
  focus.filter((f) => f === "general" || (p.tags as string[]).includes(f));

/** City-confirmed providers that offer the chosen mode, best focus match first. */
export function searchProviders(focus: Focus[], mode: ModeChoice): Provider[] {
  const matches = (p: Provider) => focusHits(p, focus).length;
  return providers
    .filter((p) => p.cityConfirmed && modeAllows(mode, p.mode))
    .sort((a, b) => matches(b) - matches(a) || b.priceInr - a.priceInr || a.id.localeCompare(b.id));
}

// ---------- 5. checkCoverage ----------
export type CoverageStatus = "covered" | "needs prescription" | "not covered";
export interface CoverageResult { providerId: string; status: CoverageStatus; reason: string }

export function checkCoverage(providerIds: string[], policy: PolicySummary): CoverageResult[] {
  return providerIds.map((id) => {
    const p = providerById(id);
    if (!p) return { providerId: id, status: "not covered", reason: "Unknown provider" };
    if (!p.cityConfirmed) return { providerId: id, status: "not covered", reason: "Not confirmed as an accredited lab in Bengaluru" };
    if (p.needsPrescription) return { providerId: id, status: "needs prescription", reason: `Genetic tests are ${policy.geneticTests}` };
    if (p.priceInr > policy.limit) return { providerId: id, status: "not covered", reason: `Costs more than the ${inr(policy.limit)} limit` };
    return { providerId: id, status: "covered", reason: `Claimable by ${policy.route}` };
  });
}

// ---------- 6. buildPlan ----------
export interface Candidate {
  providerId: string;
  priceInr: number;
  priceSource: "live" | "listed";
  rating: number | null;
  reviews: number | null;
}

export interface PlanPick {
  provider: Provider;
  priceInr: number;
  priceSource: "live" | "listed";
  priceLabel: string;
  rating: number | null;
  reviews: number | null;
  why: string;
}

export interface Plan {
  picks: PlanPick[];
  total: number;
  limit: number;
  remaining: number;
  usedText: string;
  focus: Focus[];
  mode: ModeChoice;
  prescriptionOnly: PlanPick[];
  excluded: { providerId: string; reason: string }[];
}

export const listedCandidate = (p: Provider): Candidate => ({
  providerId: p.id, priceInr: p.priceInr, priceSource: "listed", rating: null, reviews: null,
});

const priceLabel = (c: Candidate) => (c.priceSource === "live" ? "live price" : PRICES_AS_OF_LABEL);


export function buildPlan(input: { candidates: Candidate[]; limit: number; focus: Focus[]; mode: ModeChoice }): Plan {
  const limit = Math.max(0, Math.floor(input.limit));
  const { focus, mode } = input;
  const excluded: Plan["excluded"] = [];
  const pool: { c: Candidate; p: Provider }[] = [];
  const prescription: { c: Candidate; p: Provider }[] = [];
  const seen = new Set<string>();

  for (const c of input.candidates) {
    const p = providerById(c.providerId);
    if (!p || seen.has(c.providerId)) continue;
    seen.add(c.providerId);
    const price = Number.isFinite(c.priceInr) && c.priceInr > 0 ? c.priceInr : p.priceInr;
    const cand = { c: { ...c, priceInr: price }, p };
    if (!p.cityConfirmed) excluded.push({ providerId: p.id, reason: "City not confirmed" });
    else if (!modeAllows(mode, p.mode)) excluded.push({ providerId: p.id, reason: `Not ${mode === "home" ? "home collection" : "a lab visit"}` });
    else if (p.needsPrescription) prescription.push(cand);
    else if (price > limit) excluded.push({ providerId: p.id, reason: "Over the limit" });
    else pool.push(cand);
  }
  pool.sort((a, b) => a.p.id.localeCompare(b.p.id));
  const n = Math.min(pool.length, 14);

  // Lexicographic: focus areas covered → spend on focus-matching picks → distinct tests → rating → total used.
  type Score = [number, number, number, number, number];
  let best: { mask: number; score: Score; key: string } | null = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let total = 0;
    const tests = new Set<string>();
    let dup = false;
    const ratings: number[] = [];
    const covered = new Set<Focus>();
    let focusSpend = 0;
    const ids: string[] = [];
    for (let i = 0; i < n && !dup; i++) {
      if (!(mask & (1 << i))) continue;
      const { c, p } = pool[i];
      total += c.priceInr;
      for (const t of p.tests) {
        if (tests.has(t)) dup = true;
        tests.add(t);
      }
      if (c.rating != null) ratings.push(c.rating);
      const hits = focusHits(p, focus);
      hits.forEach((f) => covered.add(f));
      if (hits.length) focusSpend += c.priceInr;
      ids.push(p.id);
    }
    if (dup || total > limit) continue;
    const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const score: Score = [covered.size, focusSpend, tests.size, Math.round(avgRating * 100), total];
    const key = ids.join(",");
    if (!best || better(score, key, best.score, best.key)) best = { mask, score, key };
  }

  const toPick = ({ c, p }: { c: Candidate; p: Provider }, others: Provider[]): PlanPick => {
    const hits = focusHits(p, focus).filter((f) => f !== "general");
    const otherTests = new Set(others.flatMap((o) => o.tests));
    const fresh = p.tests.filter((t) => !otherTests.has(t)).length;
    const parts = [
      hits.length ? `Matches your ${hits.map((f) => FOCUS_LABEL[f].toLowerCase()).join(" + ")} focus` : `Broad ${p.category === "standard" ? "baseline" : "screening"} that fits your budget`,
      others.length ? `${fresh} test${fresh === 1 ? "" : "s"} your other pick doesn't repeat` : `${p.tests.length} key tests in one visit`,
      c.rating != null ? `⭐ ${c.rating.toFixed(1)} on Google` : null,
    ];
    return {
      provider: p, priceInr: c.priceInr, priceSource: c.priceSource, priceLabel: priceLabel(c),
      rating: c.rating, reviews: c.reviews, why: parts.filter(Boolean).join(" · "),
    };
  };

  const chosen = best ? pool.slice(0, n).filter((_, i) => best!.mask & (1 << i)) : [];
  const picks = chosen.map((x) => toPick(x, chosen.filter((y) => y !== x).map((y) => y.p)));
  const total = picks.reduce((s, p) => s + p.priceInr, 0);
  if (total > limit) throw new Error("Invariant violated: plan exceeds limit"); // never happens; belt and braces
  return {
    picks, total, limit, remaining: limit - total,
    usedText: `${inr(total)} of ${inr(limit)} used`,
    focus, mode,
    prescriptionOnly: prescription.map((x) => ({ ...toPick(x, []), why: "Covered only with a doctor's prescription — get one, then claim." })),
    excluded,
  };
}

function better(a: number[], aKey: string, b: number[], bKey: string): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return aKey < bKey;
}

// ---------- 7. createReminder ----------
export function createReminder(policyYearStart: string, limit = 30000): { remindOn: string; resetsOn: string; ics: string } {
  const start = new Date(`${policyYearStart}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid policy year start");
  const reset = new Date(start);
  reset.setUTCFullYear(reset.getUTCFullYear() + 1);
  const remind = new Date(reset.getTime() - 30 * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const compact = (d: Date) => ymd(d).replace(/-/g, "");
  const next = new Date(remind.getTime() + 86_400_000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Checkup Agent//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:checkup-reminder-${compact(remind)}@checkup-agent`,
    `DTSTAMP:${compact(start)}T000000Z`,
    `DTSTART;VALUE=DATE:${compact(remind)}`,
    `DTEND;VALUE=DATE:${compact(next)}`,
    `SUMMARY:Use your free ${inr(limit).replace(/,/g, "\\,")} health check-up`,
    `DESCRIPTION:Your check-up benefit resets on ${ymd(reset)}. Book your check-up\\, keep the bill + report\\, and claim within 30 days.`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  return { remindOn: ymd(remind), resetsOn: ymd(reset), ics };
}
