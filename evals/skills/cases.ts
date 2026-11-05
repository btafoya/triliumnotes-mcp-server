/** Test cases for the trilium-* skills. Each check reads the resulting Trilium state or the model's answer. */

export interface Ctx {
  calls: { name: string; input: Record<string, unknown> }[];
  answer: string;
  find: (query: string) => Promise<any[]>;
  note: (id: string) => Promise<any>;
  content: (id: string) => Promise<string>;
  revisions: (id: string) => Promise<any[]>;
}
export interface Check { text: string; run: (c: Ctx) => Promise<{ passed: boolean; evidence: string }> }
export interface Case { name: string; prompt: string; checks: Check[] }

const ok = (passed: boolean, evidence: string) => ({ passed, evidence });
const q = (title: string) => `note.title = "${title}"`;

/** Finds a note by exact title under the given parent; returns it with content. */
async function created(c: Ctx, title: string, parent: string) {
  const hit = (await c.find(q(title))).find(n => n.parentNoteIds?.includes(parent));
  if (!hit) return null;
  return { ...(await c.note(hit.noteId)), body: await c.content(hit.noteId) };
}
const noteCheck = (title: string, parent: string, fn: (n: any) => { passed: boolean; evidence: string }): Check["run"] =>
  async c => { const n = await created(c, title, parent); return n ? fn(n) : ok(false, `no note titled '${title}' under ${parent}`); };

const idx = (c: Ctx, name: string) => c.calls.findIndex(x => x.name === name);

export const CASES: Case[] = [
  {
    name: "save-python-snippet",
    prompt: "Save this helper to my Trilium notes, in the Reference folder of the Eval Sandbox, titled backoff.py:\n\n```python\ndef backoff(n):\n    return 60 if n >= 10 else min(2 ** n, 60)\n```",
    checks: [
      { text: "A note titled backoff.py exists in the Reference folder", run: noteCheck("backoff.py", "evalRef", n => ok(true, n.noteId)) },
      { text: "The note has type code", run: noteCheck("backoff.py", "evalRef", n => ok(n.type === "code", `type=${n.type}`)) },
      { text: "The note mime is text/x-python", run: noteCheck("backoff.py", "evalRef", n => ok(n.mime === "text/x-python", `mime=${n.mime}`)) },
      { text: "The content is raw source: contains 'n >= 10' unescaped", run: noteCheck("backoff.py", "evalRef", n => ok(n.body.includes("n >= 10") && !n.body.includes("&gt;"), JSON.stringify(n.body))) },
      { text: "The content has no markdown fence or HTML wrapper", run: noteCheck("backoff.py", "evalRef", n => ok(!/```|<pre|<code|<p>/.test(n.body), JSON.stringify(n.body))) }
    ]
  },
  {
    name: "save-markdown-notes",
    prompt: "Add these meeting notes to the Meeting Notes folder in my Eval Sandbox. Title: 2025-05-06 Cassini sync.\n\n# Cassini sync\n\n## Decisions\n- Pilot moves to **March**\n- Vendor shortlist cut to 3\n\n## Query used\n```sql\nSELECT vendor FROM scores WHERE total > 80;\n```",
    checks: [
      { text: "A note titled '2025-05-06 Cassini sync' exists in Meeting Notes", run: noteCheck("2025-05-06 Cassini sync", "evalMeetings", n => ok(true, n.noteId)) },
      { text: "The note has type code and mime text/x-markdown", run: noteCheck("2025-05-06 Cassini sync", "evalMeetings", n => ok(n.type === "code" && n.mime === "text/x-markdown", `type=${n.type} mime=${n.mime}`)) },
      { text: "The markdown source is kept: '## Decisions' and the sql fence are present", run: noteCheck("2025-05-06 Cassini sync", "evalMeetings", n => ok(n.body.includes("## Decisions") && n.body.includes("```sql"), JSON.stringify(n.body.slice(0, 120)))) },
      { text: "The content contains no HTML tags and keeps 'total > 80' unescaped", run: noteCheck("2025-05-06 Cassini sync", "evalMeetings", n => ok(!/<(h\d|p|ul|li|strong)>/.test(n.body) && n.body.includes("total > 80"), JSON.stringify(n.body.slice(0, 120)))) }
    ]
  },
  {
    name: "save-flowchart",
    prompt: "Put a flowchart of our deploy pipeline in my Trilium notes (Reference folder in the Eval Sandbox), called Deploy flow. Steps: push to main, CI runs tests, deploy to staging, manual approval, deploy to prod.",
    checks: [
      { text: "A note titled 'Deploy flow' exists in the Reference folder", run: noteCheck("Deploy flow", "evalRef", n => ok(true, n.noteId)) },
      { text: "The note has type mermaid and mime text/vnd.mermaid", run: noteCheck("Deploy flow", "evalRef", n => ok(n.type === "mermaid" && n.mime === "text/vnd.mermaid", `type=${n.type} mime=${n.mime}`)) },
      { text: "The content is raw Mermaid starting with graph or flowchart, without a markdown fence", run: noteCheck("Deploy flow", "evalRef", n => ok(/^\s*(graph|flowchart)\b/.test(n.body) && !n.body.includes("```"), JSON.stringify(n.body.slice(0, 100)))) },
      { text: "The diagram mentions staging and prod", run: noteCheck("Deploy flow", "evalRef", n => ok(/staging/i.test(n.body) && /prod/i.test(n.body), JSON.stringify(n.body.slice(0, 200)))) }
    ]
  },
  {
    name: "edit-code-note-safely",
    prompt: "In my Eval Sandbox, change retry.py so MAX_RETRIES is 9. Leave everything else as it is.",
    checks: [
      { text: "retry.py now contains MAX_RETRIES = 9 and keeps BACKOFF_SECONDS = 4", run: async c => { const b = (await c.content("evalRetry")); return ok(b.includes("MAX_RETRIES = 9") && b.includes("BACKOFF_SECONDS = 4"), JSON.stringify(b)); } },
      { text: "retry.py is still type code with mime text/x-python and has no HTML in it", run: async c => { const n = await c.note("evalRetry"); const b = await c.content("evalRetry"); return ok(n.type === "code" && n.mime === "text/x-python" && !/<[a-z]+>/.test(b), `type=${n.type} mime=${n.mime}`); } },
      { text: "A revision was created before the content was overwritten", run: async c => { const a = idx(c, "create_revision"), b = idx(c, "set_note_content"); return ok(a >= 0 && b >= 0 && a < b, `create_revision@${a} set_note_content@${b}`); } }
    ]
  },
  {
    name: "list-open-tasks",
    prompt: "In my Eval Sandbox, list every task that is not done, with its estimateDays, grouped by project.",
    checks: [
      ...[["Build importer", "12"], ["Write docs", "3"], ["User study", "10"], ["Vendor review", "6"], ["Pilot rollout", "20"], ["Training", "4"]].map(([t, d]): Check =>
        ({ text: `The answer lists '${t}' with ${d} days`, run: async c => ok(c.answer.includes(t) && new RegExp(`${t}[^\\n]*\\b${d}\\b`).test(c.answer), c.answer.slice(0, 200)) })),
      { text: "The answer does not list the done tasks 'Design API' (5 days) or 'Prototype' (8 days) as open", run: async c => ok(!/Design API[^\n]*\b5\b|Prototype[^\n]*\b8\b/.test(c.answer), c.answer.slice(0, 200)) }
    ]
  },
  {
    name: "lisbon-active-projects",
    prompt: "Which active projects in my Eval Sandbox are owned by someone based in Lisbon? Give titles and budgets.",
    checks: [
      { text: "The answer names Project Atlas with its 48,000 USD budget", run: async c => ok(/Atlas/.test(c.answer) && /48,?000/.test(c.answer), c.answer.slice(0, 200)) },
      { text: "The answer names Project Cassini with its 72,500 USD budget", run: async c => ok(/Cassini/.test(c.answer) && /72,?500/.test(c.answer), c.answer.slice(0, 200)) },
      { text: "The answer does not present Project Borealis (15,000 USD) as a match", run: async c => ok(!/Borealis[^\n]*15,?000/.test(c.answer), c.answer.slice(0, 200)) }
    ]
  },
  {
    name: "move-glossary-keep-note",
    prompt: "Glossary is filed in both People and Reference in my Eval Sandbox. Take it out of People but keep it in Reference.",
    checks: [
      { text: "The Glossary note still exists", run: async c => { try { const n = await c.note("evalGlossary"); return ok(true, n.title); } catch (e) { return ok(false, (e as Error).message); } } },
      { text: "Glossary has only Reference as parent", run: async c => { const n = await c.note("evalGlossary"); return ok(JSON.stringify(n.parentNoteIds) === JSON.stringify(["evalRef"]), `parents=${n.parentNoteIds}`); } },
      { text: "The tool used was delete_branch, not delete_note", run: async c => ok(c.calls.some(x => x.name === "delete_branch") && !c.calls.some(x => x.name === "delete_note"), c.calls.map(x => x.name).join(",")) }
    ]
  },
  {
    name: "restore-first-revision",
    prompt: "Restore retry.py in my Eval Sandbox to its very first saved version.",
    checks: [
      { text: "retry.py content equals the first saved version (MAX_RETRIES = 3, BACKOFF_SECONDS = 2)", run: async c => { const b = (await c.content("evalRetry")).replace(/\r\n/g, "\n").trim(); return ok(b === "MAX_RETRIES = 3\nBACKOFF_SECONDS = 2", JSON.stringify(b)); } },
      { text: "The current content was snapshotted as a revision before restoring", run: async c => { const r = await c.revisions("evalRetry"); const a = idx(c, "create_revision"), b = idx(c, "set_note_content"); return ok(a >= 0 && a < b, `create_revision@${a} set_note_content@${b} (revisions listed=${r.length})`); } }
    ]
  }
];
