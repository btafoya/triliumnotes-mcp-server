/**
 * Runs the skill test cases headlessly (`claude -p`) with and without the skills,
 * grades the resulting Trilium state, and writes the skill-creator workspace layout.
 *
 *   TRILIUM_URL=http://127.0.0.1:8095 TRILIUM_ETAPI_TOKEN=... \
 *     bun evals/skills/run.ts [--iteration 1] [--cases a,b] [--configs with_skill,without_skill]
 *
 * USE A THROWAWAY INSTANCE. Before every run it deletes everything under the Eval Sandbox
 * and under root (except _hidden), then re-seeds.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { etapi, etapiJson } from "../../src/api.js";
import { CASES, type Check } from "./cases.js";

const arg = (name: string, d: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? d : d;
};
const ITER = arg("iteration", "1");
const only = process.argv.includes("--cases") ? arg("cases", "").split(",") : null;
const CONFIGS = arg("configs", "with_skill,without_skill").split(",");
const REPO = resolve(import.meta.dirname, "../..");
const WORKSPACE = join(REPO, "skills-workspace", `iteration-${ITER}`);
const signal = new AbortController().signal;

async function resetInstance() {
  // Delete leftovers anywhere under root, then re-seed the sandbox.
  const root = await etapiJson<{ childNoteIds: string[] }>("GET", "/notes/root", { signal });
  for (const id of root?.childNoteIds ?? []) if (id !== "_hidden") await etapiJson("DELETE", `/notes/${id}`, { signal });
  const r = spawnSync("bun", [join(REPO, "evals/seed.ts")], { env: process.env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`seed failed: ${r.stderr}`);
}

function runClaude(prompt: string, cwd: string, mcpConfig: string) {
  return new Promise<{ lines: any[]; ms: number }>(resolveRun => {
    const t0 = Date.now();
    const p = spawn("claude", [
      "-p", prompt, "--output-format", "stream-json", "--verbose",
      "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", mcpConfig,
      "--allowedTools", "mcp__trilium__*", "Skill", "Read", "--max-turns", "40", "--no-session-persistence"
    ], { cwd, env: process.env });
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", () => {});
    const timer = setTimeout(() => p.kill(), 600_000);
    p.on("close", () => {
      clearTimeout(timer);
      const lines = out.split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
      resolveRun({ lines, ms: Date.now() - t0 });
    });
  });
}

const toolCalls = (lines: any[]) =>
  lines.filter(l => l.type === "assistant").flatMap(l => l.message?.content ?? []).filter((c: any) => c.type === "tool_use")
    .map((c: any) => ({ name: String(c.name).replace(/^mcp__trilium__trilium_/, ""), input: c.input }));

const mcpConfigPath = join(mkdtempSync(join(tmpdir(), "trilium-eval-")), "mcp.json");
writeFileSync(mcpConfigPath, JSON.stringify({
  mcpServers: { trilium: { command: "bun", args: [join(REPO, "src/index.ts")], env: { TRILIUM_URL: process.env.TRILIUM_URL!, TRILIUM_ETAPI_TOKEN: process.env.TRILIUM_ETAPI_TOKEN! } } }
}));

for (const c of CASES.filter(c => !only || only.includes(c.name))) {
  for (const config of CONFIGS) {
    const dir = join(WORKSPACE, c.name, config);
    mkdirSync(join(dir, "outputs"), { recursive: true });
    writeFileSync(join(WORKSPACE, c.name, "eval_metadata.json"), JSON.stringify({ eval_name: c.name, prompt: c.prompt, assertions: c.checks.map(k => k.text) }, null, 2));

    const cwd = mkdtempSync(join(tmpdir(), `trilium-run-${config}-`));
    if (config === "with_skill") cpSync(join(REPO, "skills"), join(cwd, ".claude/skills"), { recursive: true });

    await resetInstance();
    const { lines, ms } = await runClaude(c.prompt, cwd, mcpConfigPath);
    const result = lines.find(l => l.type === "result");
    const calls = toolCalls(lines);
    const answer: string = result?.result ?? "";
    const skillUsed = lines.some(l => JSON.stringify(l).includes('"name":"Skill"'));

    const ctx = { calls, answer, find: async (q: string) => (await etapiJson<{ results: any[] }>("GET", "/notes", { query: { search: q, ancestorNoteId: "root" }, signal }))?.results ?? [],
      note: (id: string) => etapiJson<any>("GET", `/notes/${id}`, { signal }),
      content: async (id: string) => (await (await etapi("GET", `/notes/${id}/content`, { signal })).text()),
      revisions: async (id: string) => (await etapiJson<any[]>("GET", `/notes/${id}/revisions`, { signal })) ?? [] };

    const expectations: { text: string; passed: boolean; evidence: string }[] = [];
    for (const k of c.checks as Check[]) {
      try { const r = await k.run(ctx); expectations.push({ text: k.text, passed: r.passed, evidence: r.evidence }); }
      catch (e) { expectations.push({ text: k.text, passed: false, evidence: `check error: ${(e as Error).message}` }); }
    }

    writeFileSync(join(dir, "outputs/transcript.jsonl"), lines.map(l => JSON.stringify(l)).join("\n"));
    writeFileSync(join(dir, "outputs/answer.md"), `${answer}\n\n---\nSkill tool used: ${skillUsed}\nTool calls: ${calls.map(x => x.name).join(", ")}\n`);
    const passed = expectations.filter(e => e.passed).length;
    writeFileSync(join(dir, "grading.json"), JSON.stringify({
      expectations, summary: { passed, failed: expectations.length - passed, total: expectations.length, pass_rate: expectations.length ? passed / expectations.length : 0 }
    }, null, 2));
    const u = result?.usage ?? {};
    const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    writeFileSync(join(dir, "timing.json"), JSON.stringify({ total_tokens: tokens, duration_ms: ms, total_duration_seconds: +(ms / 1000).toFixed(1) }));
    console.error(`${c.name} / ${config}: ${passed}/${expectations.length} passed, skill=${skillUsed}, ${calls.length} tool calls, ${(ms / 1000).toFixed(0)}s`);
  }
}
