"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentResult, NoteEvent, StepEvent } from "@/lib/types";
import type { Focus, ModeChoice } from "@/lib/guard";
import type { PlanPick } from "@/lib/planner";

const NOTE_MAX = 300;
const MEMORY_KEY = "checkup-agent:v1";

const PERSONAS = [
  { id: "arjun", label: "👨 Arjun, 27" },
  { id: "priya", label: "👩 Priya, 31" },
] as const;
type PersonaId = (typeof PERSONAS)[number]["id"];

const FOCUS_OPTIONS: { id: Exclude<Focus, "general">; label: string }[] = [
  { id: "heart", label: "❤️ Heart" },
  { id: "metabolism", label: "🍬 Sugar & metabolism" },
  { id: "hormones", label: "⚡ Hormones" },
  { id: "longevity", label: "⏳ Longevity" },
  { id: "gut", label: "🦠 Gut" },
  { id: "genetic", label: "🧬 Genetic risk" },
];
const MODE_OPTIONS: { id: ModeChoice; label: string }[] = [
  { id: "home", label: "🏠 Home sample collection" },
  { id: "lab", label: "🏥 Visit a lab" },
  { id: "either", label: "Either" },
];

interface Memory { persona: PersonaId; focus: Focus[]; mode: ModeChoice; planText: string; usedText: string }

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function readMemory(): Memory | null {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    return raw ? (JSON.parse(raw) as Memory) : null;
  } catch {
    return null;
  }
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
  const [focus, setFocus] = useState<Focus[]>([]);
  const [mode, setMode] = useState<ModeChoice>("either");
  const [note, setNote] = useState("");
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<(StepEvent | NoteEvent)[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMemory(readMemory()), []);

  const toggleFocus = (f: Focus) =>
    setFocus((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : cur.length >= 2 ? cur : [...cur, f]));

  async function run(override?: Pick<Memory, "persona" | "focus" | "mode">) {
    const p = override?.persona ?? persona;
    if (!p) { setError("Pick who you are first 🙂"); return; }
    const body = { persona: p, focus: override?.focus ?? focus, mode: override?.mode ?? mode, note: override ? "" : note, simulateFailure };
    setRunning(true); setLog([]); setResult(null); setError(null);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          if (e.type === "step") setLog((l) => { const i = l.findIndex((x) => x.type === "step" && x.id === e.id); return i < 0 ? [...l, e] : l.map((x, j) => (j === i ? e : x)); });
          else if (e.type === "note") setLog((l) => [...l, e]);
          else if (e.type === "error") setError(e.message);
          else if (e.type === "result") {
            setResult(e.result);
            const m: Memory = {
              persona: p, focus: body.focus, mode: body.mode,
              planText: e.result.plan.picks.map((x) => `${x.provider.name} ${x.provider.product}`).join(" + ") || "no plan",
              usedText: e.result.plan.usedText,
            };
            writeMemory(m); setMemory(m);
            setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  function rebuild() {
    if (!memory) return;
    setPersona(memory.persona); setFocus(memory.focus); setMode(memory.mode); setNote("");
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
      <header className="text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">🧬 Checkup Agent — Max your free ₹30,000 health check-up</h1>
        <p className="mt-1 text-slate-600">Already covered by your policy · pay at the lab, claim it back.</p>
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
      </Section>

      <Section title="B · What matters to you? (up to 2)">
        <div className="flex flex-wrap gap-2">
          {FOCUS_OPTIONS.map((f) => (
            <Chip key={f.id} active={focus.includes(f.id)} disabled={!focus.includes(f.id) && focus.length >= 2} onClick={() => toggleFocus(f.id)}>{f.label}</Chip>
          ))}
        </div>
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
          {running ? "Building…" : "Build my plan →"}
        </button>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {log.length > 0 && (
        <Section title={running ? "Agent at work…" : "What the agent did"}>
          <ul className="space-y-1 font-mono text-xs sm:text-sm">
            {log.map((s, i) => s.type === "note" ? (
              <li key={`n${i}`} className="font-sans font-medium text-slate-800">{s.icon} {s.text}</li>
            ) : (
              <li key={s.id} className="flex gap-2">
                <span className="w-5 shrink-0">{s.status === "running" ? "⏳" : s.status === "ok" ? "✓" : s.status === "warn" ? "⚠️" : "✗"}</span>
                <span className="shrink-0 font-semibold">{s.tool}</span>
                <span className="min-w-0 flex-1 text-slate-600">{s.summary}</span>
                {s.ms != null && <span className="shrink-0 text-slate-400">{(s.ms / 1000).toFixed(1)}s</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result && <Result result={result} refEl={resultRef} onIcs={downloadIcs} />}

      <footer className="pt-4 text-center text-xs text-slate-500">
        Mock policies, public listed prices. Not medical advice — ask your doctor which tests suit you.
      </footer>
    </main>
  );
}

function PickCard({ pick, mapsUrl, genetic }: { pick: PlanPick; mapsUrl: string; genetic?: boolean }) {
  const p = pick.provider;
  return (
    <div className={`rounded-2xl border p-4 ${genetic ? "border-violet-200 bg-violet-50" : "border-emerald-200 bg-white"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{p.name} · {p.product}</h3>
        <span className="text-lg font-bold">{inr(pick.priceInr)} <span className="text-xs font-normal text-slate-500">{pick.priceLabel}</span></span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{p.covers}</p>
      <p className="mt-1 text-sm">{pick.rating != null ? `⭐ ${pick.rating.toFixed(1)}${pick.reviews != null ? ` · ${pick.reviews.toLocaleString("en-IN")} reviews` : ""}` : "⭐ rating unavailable"} · {p.mode} · {p.location}</p>
      <p className="mt-2 text-sm"><b>{genetic ? "Note:" : "Why this:"}</b> {pick.why}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <a href={p.bookingUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-emerald-600 px-3 py-1.5 font-medium text-white">Book now →</a>
        <a href={p.contactUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-slate-300 bg-white px-3 py-1.5">Talk to the lab →</a>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="rounded-full border border-slate-300 bg-white px-3 py-1.5">See reviews on Google →</a>
      </div>
    </div>
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

      <Section title={`Options compared for ${result.persona.name}`}>
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
                  <td className="pr-3 whitespace-nowrap">{r.rating != null ? `⭐ ${r.rating.toFixed(1)}` : "unavailable"}</td>
                  <td className="pr-3 whitespace-nowrap">{r.mode}</td>
                  <td>{r.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Your recommended plan">
        <div className="mb-3 rounded-xl bg-emerald-50 p-3 text-center font-semibold text-emerald-800">{plan.usedText}</div>
        <div className="flex flex-col gap-3">
          {plan.picks.length === 0 && <p className="text-sm">No combination fits the limit for these choices — try “Either” for mode.</p>}
          {plan.picks.map((p) => <PickCard key={p.provider.id} pick={p} mapsUrl={result.mapsUrls[p.provider.id]} />)}
        </div>
      </Section>

      {plan.prescriptionOnly.length > 0 && (
        <Section title="🧬 Genetic risk (separate)">
          <p className="mb-3 text-sm">Covered only with a doctor&apos;s prescription — get one, then claim.</p>
          {plan.prescriptionOnly.map((p) => <PickCard key={p.provider.id} pick={p} mapsUrl={result.mapsUrls[p.provider.id]} genetic />)}
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
