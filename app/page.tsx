"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentResult, MilestoneEvent, NoteEvent, StepEvent } from "@/lib/types";
import type { Focus, ModeChoice } from "@/lib/guard";
import type { PlanPick } from "@/lib/planner";

const NOTE_MAX = 300;
const MEMORY_KEY = "checkup-agent:v2";
const DEFAULT_SUM_INSURED = 30_00_000;
const SUM_MIN = 1_00_000;
const SUM_MAX = 10_00_00_000;
const limitFor = (sum: number) => Math.round(sum * 0.01);

const PERSONAS = [
  { id: "arjun", label: "👨 Arjun, 27" },
  { id: "priya", label: "👩 Priya, 31" },
  { id: "custom", label: "✏️ Enter my own" },
] as const;
type PersonaId = (typeof PERSONAS)[number]["id"];
type Gender = "" | "Male" | "Female" | "Other";

type FocusChip = { id: Exclude<Focus, "general">; label: string };
const TRENDING: FocusChip[] = [
  { id: "longevity", label: "⏳ Longevity" },
  { id: "fullbody", label: "🧠 Full-body scan (MRI/AI)" },
  { id: "genetic", label: "🧬 Genetic risk" },
  { id: "gut", label: "🦠 Gut microbiome" },
  { id: "stamina", label: "🏃 Stamina (VO2 max)" },
];
const CLASSICS: FocusChip[] = [
  { id: "heart", label: "❤️ Heart" },
  { id: "metabolism", label: "🍬 Sugar & metabolism" },
  { id: "hormones", label: "⚡ Hormones" },
  { id: "thyroid", label: "🦋 Thyroid" },
  { id: "bone", label: "🦴 Bone density" },
  { id: "vitamins", label: "💊 Vitamins" },
];
const MODE_OPTIONS: { id: ModeChoice; label: string }[] = [
  { id: "home", label: "🏠 Home sample collection" },
  { id: "lab", label: "🏥 Visit a lab" },
  { id: "either", label: "Either" },
];

interface Memory { persona: PersonaId; focus: Focus[]; mode: ModeChoice; sumInsured: number; planText: string; usedText: string }

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function readMemory(): Memory | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return raw ? (JSON.parse(raw) as Memory) : null;
  } catch {
    return null;
  }
}
function clearMemory() {
  try {
    localStorage.removeItem(MEMORY_KEY);
    localStorage.removeItem("checkup-agent:v1"); // older format
  } catch { /* storage unavailable */ }
}
function writeMemory(m: Memory) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(m)); } catch { /* storage unavailable */ }
}

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-full border px-4 py-2 text-sm transition ${
        active ? "border-emerald-600 bg-emerald-600 text-white shadow" : "border-slate-300 bg-white hover:border-emerald-500"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function Home() {
  const [persona, setPersona] = useState<PersonaId | null>(null);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("");
  const [sumInsured, setSumInsured] = useState(DEFAULT_SUM_INSURED);
  const [editingSum, setEditingSum] = useState(false);
  const [sumDraft, setSumDraft] = useState(String(DEFAULT_SUM_INSURED));
  const [focus, setFocus] = useState<Focus[]>([]);
  const [mode, setMode] = useState<ModeChoice>("either");
  const [note, setNote] = useState("");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [running, setRunning] = useState(false);
  const [friendly, setFriendly] = useState<(MilestoneEvent | NoteEvent)[]>([]);
  const [tech, setTech] = useState<StepEvent[]>([]);
  const [showTech, setShowTech] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function startOver() {
    abortRef.current?.abort();
    clearMemory();
    setMemory(null);
    setPersona(null); setName(""); setAge(""); setGender("");
    setSumInsured(DEFAULT_SUM_INSURED); setSumDraft(String(DEFAULT_SUM_INSURED)); setEditingSum(false);
    setFocus([]); setMode("either"); setNote(""); setSimulateFailure(false);
    setFriendly([]); setTech([]); setShowTech(false);
    setResult(null); setError(null); setRunning(false);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  useEffect(() => setMemory(readMemory()), []);

  const toggleFocus = (f: Focus) =>
    setFocus((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : cur.length >= 2 ? cur : [...cur, f]));

  const ageError = (() => {
    if (persona !== "custom" || !age.trim()) return null;
    const n = Number(age);
    return Number.isInteger(n) && n >= 18 && n <= 90 ? null : "Age must be between 18 and 90";
  })();

  function saveSum() {
    const n = Number(sumDraft.replace(/[^\d]/g, ""));
    if (!Number.isInteger(n) || n < SUM_MIN || n > SUM_MAX) {
      setError(`Sum insured must be between ${inr(SUM_MIN)} and ${inr(SUM_MAX)}.`);
      return;
    }
    setError(null); setSumInsured(n); setEditingSum(false);
  }

  async function run(override?: Pick<Memory, "persona" | "focus" | "mode" | "sumInsured">) {
    const p: PersonaId = override?.persona ?? persona ?? "arjun"; // default persona if left empty
    if (!override && ageError) { setError(ageError); return; }
    const profile = p === "custom" && !override
      ? { name: name.trim(), ...(age.trim() ? { age: Number(age) } : {}), ...(gender ? { gender } : {}) }
      : undefined;
    const body = {
      persona: p, profile, sumInsured: override?.sumInsured ?? sumInsured,
      focus: override?.focus ?? focus, mode: override?.mode ?? mode, note: override ? "" : note, simulateFailure,
    };
    setRunning(true); setFriendly([]); setTech([]); setResult(null); setError(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Couldn't reach the planner. Please try again.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (ctrl.signal.aborted) return;
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          if (e.type === "step") setTech((l) => { const i = l.findIndex((x) => x.id === e.id); return i < 0 ? [...l, e] : l.map((x, j) => (j === i ? e : x)); });
          else if (e.type === "milestone") setFriendly((l) => { const i = l.findIndex((x) => x.type === "milestone" && x.key === e.key); return i < 0 ? [...l, e] : l.map((x, j) => (j === i ? e : x)); });
          else if (e.type === "note") setFriendly((l) => [...l, e]);
          else if (e.type === "error") setError(e.message);
          else if (e.type === "result") {
            setResult(e.result);
            const m: Memory = {
              persona: p, focus: body.focus, mode: body.mode, sumInsured: body.sumInsured,
              planText: e.result.plan.picks.map((x) => `${x.provider.name} ${x.provider.product}`).join(" + ") || "no plan",
              usedText: e.result.plan.usedText,
            };
            writeMemory(m); setMemory(m);
            setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (abortRef.current === ctrl) setRunning(false);
    }
  }

  function rebuild() {
    if (!memory) return;
    setPersona(memory.persona); setFocus(memory.focus); setMode(memory.mode); setNote("");
    setSumInsured(memory.sumInsured); setSumDraft(String(memory.sumInsured));
    run(memory);
  }

  function downloadIcs() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.reminder.ics], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "checkup-reminder.ics" });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="relative pt-8 text-center sm:pt-0">
        <StartOverButton onClick={startOver} className="absolute right-0 top-0" />
        <p className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-emerald-700">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG, no optimisation needed */}
          <img src="/icon.svg" alt="" width={28} height={28} className="h-7 w-7" />
          CHECKUP AGENT
        </p>
        <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Max your free health check-up.</h1>
        <p className="mt-1 text-slate-600">It&apos;s one life — build it for longevity.</p>
        <div className="mt-3 text-lg text-slate-700">
          {editingSum ? (
            <span className="inline-flex flex-wrap items-center justify-center gap-2">
              Sum insured ₹
              <input
                autoFocus inputMode="numeric" value={sumDraft}
                onChange={(e) => setSumDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                onKeyDown={(e) => e.key === "Enter" && saveSum()}
                className="w-36 rounded-lg border border-emerald-400 px-2 py-1 text-slate-900"
                aria-label="Annual sum insured in rupees"
              />
              → <b>{inr(limitFor(Number(sumDraft) || 0))}</b> free check-up (1%)
              <button onClick={saveSum} className="rounded-full bg-emerald-600 px-3 py-1 text-sm font-semibold text-white">✓ Save</button>
            </span>
          ) : (
            <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span>Assuming <b>{inr(sumInsured)}</b> sum insured → <b className="text-emerald-700">{inr(limitFor(sumInsured))} free check-up</b> (1%)</span>
              <button onClick={() => { setSumDraft(String(sumInsured)); setEditingSum(true); }} className="rounded-full border border-emerald-600 bg-white px-3 py-1 text-sm font-semibold text-emerald-700 shadow-sm hover:bg-emerald-50">✏️ Change</button>
            </span>
          )}
        </div>
      </header>

      {memory && !result && !running && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <span>Welcome back — your last plan: <b>{memory.planText}</b> · {memory.usedText}</span>
          <button onClick={rebuild} className="rounded-full bg-emerald-600 px-3 py-1 font-medium text-white">Rebuild?</button>
        </div>
      )}

      <Section title="A · Who are you?">
        <div className="flex flex-wrap gap-2">
          {PERSONAS.map((p) => <Chip key={p.id} active={persona === p.id} onClick={() => setPersona(p.id)}>{p.label}</Chip>)}
        </div>
        {persona === "custom" && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="rounded-xl border border-slate-300 p-2 text-sm" />
            <div>
              <input value={age} inputMode="numeric" onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, "").slice(0, 2))} placeholder="Age (18–90)" className={`w-full rounded-xl border p-2 text-sm ${ageError ? "border-rose-400" : "border-slate-300"}`} />
              {ageError && <p className="mt-1 text-xs text-rose-600">{ageError}</p>}
            </div>
            <select value={gender} onChange={(e) => setGender(e.target.value as Gender)} className="rounded-xl border border-slate-300 bg-white p-2 text-sm">
              <option value="">Gender (optional)</option>
              <option>Female</option><option>Male</option><option>Other</option>
            </select>
          </div>
        )}
        {!persona && <p className="mt-2 text-xs text-slate-500">Skip this and I&apos;ll use Arjun&apos;s profile.</p>}
      </Section>

      <Section title="B · What matters to you? (up to 2)">
        {[TRENDING, CLASSICS].map((row, i) => (
          <div key={i} className="mb-2 flex flex-wrap items-center gap-2">
            {i === 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">🔥 Trending</span>}
            {row.map((f) => (
              <Chip key={f.id} active={focus.includes(f.id)} disabled={!focus.includes(f.id) && focus.length >= 2} onClick={() => toggleFocus(f.id)}>{f.label}</Chip>
            ))}
          </div>
        ))}
        {focus.length === 0 && <p className="mt-2 text-xs text-slate-500">Skip this and I&apos;ll plan a General check-up.</p>}
      </Section>

      <Section title="C · How do you prefer it?">
        <div className="flex flex-wrap gap-2">
          {MODE_OPTIONS.map((m) => <Chip key={m.id} active={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</Chip>)}
        </div>
      </Section>

      <Section title="Anything else? (optional)">
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          rows={2}
          placeholder="e.g. family history of diabetes, prefer weekend mornings"
          className="w-full rounded-xl border border-slate-300 p-3 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <div className="mt-1 text-right text-xs text-slate-500">{note.length}/{NOTE_MAX}</div>
      </Section>

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={simulateFailure} onChange={(e) => setSimulateFailure(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Simulate tool failure (prices &amp; ratings)
        </label>
        <button
          onClick={() => run()}
          disabled={running}
          className="rounded-full bg-emerald-600 px-6 py-3 text-lg font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
        >
          {running ? "Building…" : "Build & Book my plan →"}
        </button>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {(friendly.length > 0 || running) && (
        <Section title={running ? "Working on your plan…" : "Here's what I did"}>
          <ul className="space-y-2">
            {friendly.map((m, i) => m.type === "milestone" ? (
              <li key={m.key} className="flex items-start gap-3 animate-[fadeIn_.3s_ease-out]">
                <span className="text-xl leading-6">{m.emoji}</span>
                <span className="flex-1 leading-6">{m.text}</span>
                <span className="font-bold text-emerald-600">✓</span>
              </li>
            ) : (
              <li key={`n${i}`} className="flex items-start gap-3 text-sm text-slate-600">
                <span className="text-xl leading-6">{m.icon}</span>
                <span className="flex-1 leading-6">{m.text}</span>
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-3 text-slate-500">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                <span>Working on it…</span>
              </li>
            )}
          </ul>
          {tech.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <button onClick={() => setShowTech((v) => !v)} className="text-xs font-medium text-slate-500 underline" aria-expanded={showTech}>
                🔧 {showTech ? "Hide" : "Show"} technical details
              </button>
              {showTech && (
                <ul className="mt-2 space-y-1 font-mono text-xs">
                  {tech.map((t) => (
                    <li key={t.id} className="flex gap-2">
                      <span className="w-5 shrink-0">{t.status === "running" ? "⏳" : t.status === "ok" ? "✓" : t.status === "warn" ? "⚠️" : "✗"}</span>
                      <span className="shrink-0 font-semibold">{t.tool}</span>
                      <span className="min-w-0 flex-1 text-slate-600">{t.summary}</span>
                      {t.ms != null && <span className="shrink-0 text-slate-400">{(t.ms / 1000).toFixed(1)}s</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      )}

      {result && <Result result={result} refEl={resultRef} onIcs={downloadIcs} />}
      {result && <div className="flex justify-center"><StartOverButton onClick={startOver} /></div>}

      <footer className="pt-4 text-center text-xs text-slate-500">
        Mock policies, public listed prices. Not medical advice — ask your doctor which tests suit you.
      </footer>
    </main>
  );
}

/** Live labels stay as-is; stored ones ("… · Google · 22 Nov") show the date as a small tag. */
function splitRating(label: string) {
  const m = label.match(/^(.*) · Google · (.+)$/);
  return m ? { main: m[1], asOf: `as of ${m[2]}` } : { main: label, asOf: "" };
}

function PickCard({ pick, mapsUrl, ratingLabel, calm }: { pick: PlanPick; mapsUrl: string; ratingLabel: string; calm?: boolean }) {
  const p = pick.provider;
  const { main, asOf } = splitRating(ratingLabel);
  return (
    <div className={`rounded-2xl p-4 ${calm ? "border border-slate-200 bg-slate-50" : "bg-white text-slate-900 shadow-md"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{p.name} · {p.product}</h3>
          <p className="text-sm">{main} {asOf && <span className="text-xs text-slate-400">{asOf}</span>}</p>
        </div>
        <div className="sm:text-right">
          <div className={`${calm ? "text-lg" : "text-3xl"} font-extrabold`}>{inr(pick.priceInr)}</div>
          <div className="text-xs text-slate-500">{pick.priceLabel}</div>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">{p.covers}</p>
      <p className="mt-1 text-xs text-slate-500">{p.mode} · {p.location}</p>
      <p className="mt-2 text-sm"><b>{calm ? "Note:" : "Why this:"}</b> {pick.why}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <a href={p.bookingUrl} target="_blank" rel="noopener noreferrer" className={`rounded-full px-3 py-1.5 font-medium ${calm ? "border border-slate-400 bg-white" : "bg-emerald-600 text-white"}`}>Book now →</a>
        <a href={p.contactUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-slate-300 bg-white px-3 py-1.5">Talk to the lab →</a>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-slate-300 bg-white px-3 py-1.5">See reviews on Google →</a>
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ["#10b981", "#14b8a6", "#f59e0b", "#f43f5e", "#6366f1", "#facc15"];

/** A light, one-off burst. Skipped entirely for reduced-motion users. */
function Confetti() {
  const [pieces, setPieces] = useState<{ left: number; delay: number; color: string; rotate: number }[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPieces(Array.from({ length: 36 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 0.4, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], rotate: Math.random() * 360,
    })));
    const t = setTimeout(() => setPieces([]), 2600);
    return () => clearTimeout(t);
  }, []);
  if (!pieces.length) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((c, i) => (
        <span key={i} className="confetti" style={{ left: `${c.left}%`, background: c.color, animationDelay: `${c.delay}s`, transform: `rotate(${c.rotate}deg)` }} />
      ))}
    </div>
  );
}

function StartOverButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:border-emerald-500 ${className}`}>
      🔄 Start over
    </button>
  );
}

function Result({ result, refEl, onIcs }: { result: AgentResult; refEl: React.RefObject<HTMLDivElement | null>; onIcs: () => void }) {
  const { plan, shortlist, policy } = result;
  return (
    <div ref={refEl} className="flex flex-col gap-4">
      {result.notes.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {result.notes.map((n, i) => <p key={i}>⚠️ {n}</p>)}
        </div>
      )}

      <Section title={`Options compared for ${result.persona.name}${result.persona.age != null ? `, ${result.persona.age}` : ""}`}>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-3">Provider</th><th className="pr-3">What it checks</th><th className="pr-3">Price</th><th className="pr-3">Rating</th><th className="pr-3">Mode</th><th>Location</th></tr>
            </thead>
            <tbody>
              {shortlist.map((r) => (
                <tr key={r.providerId} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 font-medium">{r.name}<div className="text-xs font-normal text-slate-500">{r.product}{r.coverage === "needs prescription" ? " · needs prescription" : ""}</div></td>
                  <td className="pr-3 text-slate-600">{r.covers}</td>
                  <td className="pr-3 whitespace-nowrap">{inr(r.priceInr)}<div className="text-xs text-slate-500">{r.priceSource === "live" ? "live" : r.priceLabel}</div></td>
                  <td className="pr-3">{r.ratingLabel}</td>
                  <td className="pr-3 whitespace-nowrap">{r.mode}</td>
                  <td>{r.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {plan.picks.length > 0 ? (
        <section className="rounded-3xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 p-4 text-white shadow-lg sm:p-6">
          <Confetti />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold">Your recommended plan</h2>
            <span className="rounded-full bg-white px-4 py-1.5 text-base font-extrabold text-emerald-700 shadow">✅ 100% reimbursable</span>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-lg font-extrabold"><span>{plan.usedText}</span><span>{Math.round((plan.total / plan.limit) * 100)}%</span></div>
            <div className="mt-2 h-4 overflow-hidden rounded-full bg-white/30" role="progressbar" aria-valuenow={plan.total} aria-valuemin={0} aria-valuemax={plan.limit} aria-label="Check-up budget used">
              <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, (plan.total / plan.limit) * 100)}%` }} />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {plan.picks.map((p) => <PickCard key={p.provider.id} pick={p} mapsUrl={result.mapsUrls[p.provider.id]} ratingLabel={result.ratingLabels[p.provider.id]} />)}
          </div>
        </section>
      ) : (
        <Section title="Your recommended plan">
          <p className="text-sm">No combination fits your {inr(plan.limit)} limit for these choices — try “Either” for mode, or see the options below.</p>
        </Section>
      )}

      {(plan.prescriptionOnly.length > 0 || plan.overLimit.length > 0) && (
        <Section title="Also worth considering (you pay, or needs a prescription)">
          <div className="flex flex-col gap-3">
            {[...plan.prescriptionOnly, ...plan.overLimit].map((p) => <PickCard key={p.provider.id} pick={p} mapsUrl={result.mapsUrls[p.provider.id]} ratingLabel={result.ratingLabels[p.provider.id]} calm />)}
          </div>
        </Section>
      )}

      <Section title="✅ Claim checklist">
        <ul className="space-y-1 text-sm">
          <li>☐ Book and pay at the lab — this is <b>{policy.route}</b> (not cashless).</li>
          <li>☐ Keep the itemised bill and your report.</li>
          <li>☐ Submit the claim within {policy.claimWithinDays} days of the check-up.</li>
          <li>☐ Total to claim: <b>{inr(plan.total)}</b> of your {inr(policy.limit)} limit.</li>
        </ul>
        <button onClick={onIcs} className="mt-3 rounded-full border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700">
          📅 Add reminder ({result.reminder.remindOn}, before your benefit resets)
        </button>
      </Section>
    </div>
  );
}
