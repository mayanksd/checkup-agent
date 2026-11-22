// Drives the real streamText tool loop with a scripted mock model (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runAgent } from "../lib/agent.ts";
import { RequestSchema } from "../lib/guard.ts";

delete process.env.ANTHROPIC_API_KEY;

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const call = (toolName: string, input: unknown, i: number) => ({ type: "tool-call", toolCallId: `c${i}`, toolName, input: JSON.stringify(input) });
const finish = (unified: string) => ({ type: "finish", finishReason: { unified, raw: undefined }, usage });

function scripted(turns: { toolName: string; input: unknown }[][]) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const turn = turns[step++];
      const chunks = turn
        ? [...turn.map((c, i) => call(c.toolName, c.input, step * 10 + i)), finish("tool-calls")]
        : [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Here's your plan!" }, { type: "text-end", id: "t" }, finish("stop")];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  });
}

test("agent loop: model-chosen tool calls produce a plan; a hostile limit is clamped", async () => {
  const tools: string[] = [];
  const notes: string[] = [];
  const model = scripted([
    [{ toolName: "getPolicy", input: { personaId: "priya" } }],
    [{ toolName: "searchProviders", input: { focus: ["heart"], mode: "lab" } }],
    [
      { toolName: "checkLivePrice", input: { providerId: "cent-fullbody" } },
      { toolName: "getRating", input: { providerId: "cent-fullbody" } },
      { toolName: "checkLivePrice", input: { providerId: "supprx-ultra" } },
    ],
    [{ toolName: "checkCoverage", input: { providerIds: ["cent-fullbody", "nura-ai"], personaId: "priya" } }],
    [{ toolName: "buildPlan", input: { candidateIds: ["cent-fullbody", "nura-ai", "supprx-ultra"], limit: 1000000, focus: ["heart"], mode: "lab" } }],
    [{ toolName: "createReminder", input: { policyYearStart: "2026-01-01" } }],
  ]);
  const r = await runAgent(
    RequestSchema.parse({ persona: "priya", focus: ["heart"], mode: "lab", simulateFailure: true }),
    (e) => {
      if (e.type === "step" && e.status !== "running") tools.push(e.tool);
      if (e.type === "note") notes.push(e.text);
    },
    { model },
  );
  assert.equal(r.driver, "agent");
  assert.deepEqual(tools.slice(0, 2), ["getPolicy", "searchProviders"]);
  assert.ok(tools.includes("buildPlan") && tools.includes("createReminder"));
  assert.equal(r.plan.limit, 30000);
  assert.ok(r.plan.total <= 30000 && r.plan.picks.length > 0);
  assert.ok(!r.plan.picks.some((p) => p.provider.id === "supprx-ultra"));
  assert.ok(notes.includes("Ignored 1 suspicious instruction in the policy"));
});

test("agent loop: if the model stops early, code finishes the plan", async () => {
  const model = scripted([[{ toolName: "getPolicy", input: { personaId: "arjun" } }]]);
  const r = await runAgent(RequestSchema.parse({ persona: "arjun", focus: [], mode: "home", simulateFailure: true }), () => {}, { model });
  assert.deepEqual(r.focus, ["general"]);
  assert.ok(r.plan.picks.length > 0 && r.plan.total <= 30000);
  assert.ok(r.plan.picks.every((p) => p.provider.mode === "home collection"));
});
