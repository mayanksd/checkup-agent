// Input validation and prompt-injection defences. Pure code, no model calls.
import { z } from "zod";

export const FOCUS_VALUES = [
  "longevity", "fullbody", "genetic", "gut", "stamina",
  "heart", "metabolism", "hormones", "thyroid", "bone", "vitamins", "general",
] as const;
export const MODE_VALUES = ["home", "lab", "either"] as const;
export const PERSONA_VALUES = ["arjun", "priya", "custom"] as const;

export const FocusSchema = z.enum(FOCUS_VALUES, { error: "Pick from the listed focus areas" });
export const ModeSchema = z.enum(MODE_VALUES, { error: "Choose home, lab or either" });
export const PersonaSchema = z.enum(PERSONA_VALUES, { error: "Pick Arjun, Priya or enter your own" });

export type Focus = z.infer<typeof FocusSchema>;
export type ModeChoice = z.infer<typeof ModeSchema>;

export const NOTE_MAX = 300;

/** Check-up benefit = 1% of the annual sum insured. */
export const CHECKUP_PERCENT = 0.01;
export const DEFAULT_SUM_INSURED = 30_00_000;
export const SUM_INSURED_MIN = 1_00_000;
export const SUM_INSURED_MAX = 10_00_00_000;
export const checkupLimitFor = (sumInsured: number) => Math.round(sumInsured * CHECKUP_PERCENT);

export const SumInsuredSchema = z
  .number({ error: "Enter the sum insured in rupees" })
  .int("Use whole rupees")
  .min(SUM_INSURED_MIN, "Sum insured must be at least ₹1,00,000")
  .max(SUM_INSURED_MAX, "Sum insured must be at most ₹10,00,00,000");

export const ProfileSchema = z.object({
  name: z.string().trim().max(40, "Keep the name under 40 characters")
    .regex(/^[\p{L} .'-]*$/u, "Use letters only in the name").optional().default(""),
  age: z.number({ error: "Age must be a number" }).int("Age must be a whole number")
    .min(18, "Age must be between 18 and 90").max(90, "Age must be between 18 and 90").optional(),
  gender: z.enum(["Male", "Female", "Other"], { error: "Pick a gender option" }).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const RequestSchema = z.object({
  persona: PersonaSchema.default("arjun"),
  profile: ProfileSchema.optional(),
  sumInsured: SumInsuredSchema.default(DEFAULT_SUM_INSURED),
  focus: z.array(FocusSchema).max(2, "Pick up to 2 things").default([]),
  mode: ModeSchema.default("either"),
  note: z.string().max(NOTE_MAX, `Keep it under ${NOTE_MAX} characters`).optional().default(""),
  simulateFailure: z.boolean().optional().default(false),
});
export type AgentRequest = z.infer<typeof RequestSchema>;

/** No focus → General. Dedupe, cap at 2, drop "general" when real picks exist. */
export function normaliseFocus(focus: Focus[]): Focus[] {
  const picks = [...new Set(focus)].filter((f) => f !== "general").slice(0, 2);
  return picks.length ? picks : ["general"];
}

const INJECTION_PATTERNS: RegExp[] = [
  /^\s*(system|assistant|developer|user)\s*:/i,
  /\bignore\b.*\b(rules?|instructions?|previous|above|policy)\b/i,
  /\bdisregard\b/i,
  /\bset\s+(the\s+)?(check-?up\s+)?limit\b/i,
  /\b(override|bypass)\b/i,
  /\byou\s+are\s+now\b/i,
];

export const looksLikeInstruction = (line: string) => INJECTION_PATTERNS.some((re) => re.test(line));

/** Split policy wording into lines and drop anything that reads like an instruction. */
export function sanitizePolicyText(text: string): { rules: string[]; ignored: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rules = lines.filter((l) => !looksLikeInstruction(l));
  return { rules, ignored: lines.length - rules.length };
}

const HEALTH_WORDS =
  /\b(stamina|vo2|microbiome|bone|bones|osteo\w*|vitamin|vitamins|mri|full-body|longevity|test|tests|check|checkup|check-up|heart|cardiac|bp|pressure|cholesterol|sugar|diabet\w*|thyroid|hormon\w*|pcos|blood|vitamin\w*|weight|sleep|stress|energy|tired|fatigue|gut|digest\w*|bloat\w*|stomach|cancer|genetic\w*|dna|family|history|doctor|fit|fitness|gym|run\w*|age|ageing|aging|longevity|home|lab|weekend|morning|evening|near|koramangala|indiranagar|domlur|fast|fasting|scan|mri|ct|dexa|bone|lung|eye|hearing|liver|kidney|budget|price|cheap|quick|metabol\w*|insulin|anxious|nervous|needle|prefer|want|worried|concern\w*)\b/i;

const FOCUS_HINTS: [RegExp, Focus][] = [
  [/\b(thyroid)\b/i, "thyroid"],
  [/\b(bone|bones|osteo\w*|dexa)\b/i, "bone"],
  [/\b(vitamin\w*|b12|iron)\b/i, "vitamins"],
  [/\b(stamina|vo2|endurance)\b/i, "stamina"],
  [/\b(mri|full-body scan|body scan|scan)\b/i, "fullbody"],
  [/\b(heart|cardiac|bp|pressure|cholesterol)\b/i, "heart"],
  [/\b(sugar|diabet\w*|insulin|metabol\w*|weight)\b/i, "metabolism"],
  [/\b(hormon\w*|pcos|testosterone)\b/i, "hormones"],
  [/\b(gut|microbiome|digest\w*|bloat\w*|stomach)\b/i, "gut"],
  [/\b(longevity|ageing|aging)\b/i, "longevity"],
  [/\b(genetic\w*|dna)\b/i, "genetic"],
];

function isGibberish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return true;
  const bad = words.filter(
    (w) => /[^aeiouy]{5,}/.test(w) || /(.)\1{3,}/.test(w) || (w.length > 3 && !/[aeiouy]/.test(w)) || w.length > 20,
  );
  return bad.length / words.length > 0.5;
}

export type NoteCheck =
  | { kind: "empty" }
  | { kind: "ok"; note: string; hints: Focus[]; stripped: number }
  | { kind: "redirect"; message: string; stripped: number };

/** Classify the optional free-text note. Only "ok" notes ever reach the model. */
export function checkNote(raw: string): NoteCheck {
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, NOTE_MAX);
  if (!text) return { kind: "empty" };
  const sentences = text.split(/(?<=[.!?\n])\s+/);
  const kept = sentences.filter((s) => !looksLikeInstruction(s));
  const stripped = sentences.length - kept.length;
  const clean = kept.join(" ").trim();
  const redirect = "I can only help plan your health check-up, so I'll go with your picks above. Try something like “family history of diabetes” or “prefer weekend mornings”.";
  if (!clean) return { kind: "redirect", message: redirect, stripped };
  if (isGibberish(clean)) return { kind: "redirect", message: "I couldn't make sense of that note — no worries, I'll plan from your picks above.", stripped };
  if (!HEALTH_WORDS.test(clean)) return { kind: "redirect", message: redirect, stripped };
  const hints = FOCUS_HINTS.filter(([re]) => re.test(clean)).map(([, f]) => f);
  return { kind: "ok", note: clean, hints: [...new Set(hints)], stripped };
}
