/**
 * Seeds (or removes) the "Eval Sandbox" subtree that evals/trilium_eval.xml asks about.
 *
 *   TRILIUM_URL=... TRILIUM_ETAPI_TOKEN=... bun evals/seed.ts          # create
 *   TRILIUM_URL=... TRILIUM_ETAPI_TOKEN=... bun evals/seed.ts --clean  # delete
 *
 * Notes use fixed IDs (eval*), so the script refuses to run if evalRoot already exists.
 * Writes only under one new note, "Eval Sandbox", directly below root.
 */
import { etapiJson, EtapiError } from "../src/api.js";

const signal = new AbortController().signal;
const api = <T>(method: string, path: string, json?: unknown) => etapiJson<T>(method, path, { json, signal });

type Attr = [type: "label" | "relation", name: string, value?: string];
interface Seed {
  id: string;
  parent: string;
  title: string;
  content?: string;
  type?: "text" | "code" | "book";
  mime?: string;
  attrs?: Attr[];
}

const task = (id: string, parent: string, title: string, desc: string, status: string, days: number): Seed => ({
  id, parent, title, content: `<p>${desc}</p>`, attrs: [["label", "status", status], ["label", "estimateDays", String(days)]]
});

// Parents are listed before their children.
const NOTES: Seed[] = [
  { id: "evalRoot", parent: "root", title: "Eval Sandbox", type: "book", content: "<p>Seed data for trilium-mcp-server evaluations. Safe to delete.</p>", attrs: [["label", "evalRoot"]] },
  { id: "evalProjects", parent: "evalRoot", title: "Projects", type: "book" },
  { id: "evalPeople", parent: "evalRoot", title: "People", type: "book" },
  { id: "evalMeetings", parent: "evalRoot", title: "Meeting Notes", type: "book" },
  { id: "evalRef", parent: "evalRoot", title: "Reference", type: "book" },

  { id: "evalAtlas", parent: "evalProjects", title: "Project Atlas", content: "<p>Customer data platform migration. Budget: 48,000 USD. Launch target: 2025-09-30.</p>",
    attrs: [["label", "status", "active"], ["label", "priority", "2"], ["relation", "owner", "evalMaria"]] },
  { id: "evalBorealis", parent: "evalProjects", title: "Project Borealis", content: "<p>Mobile app prototype research. Budget: 15,000 USD. Paused since 2025-04-18.</p>",
    attrs: [["label", "status", "paused"], ["label", "priority", "1"], ["relation", "owner", "evalChen"]] },
  { id: "evalCassini", parent: "evalProjects", title: "Project Cassini", content: "<p>Warehouse vendor consolidation. Budget: 72,500 USD. Launch target: 2026-01-15.</p>",
    attrs: [["label", "status", "active"], ["label", "priority", "3"], ["relation", "owner", "evalMaria"]] },

  task("evalAtlasT1", "evalAtlas", "Design API", "REST design for the Atlas importer endpoints.", "done", 5),
  task("evalAtlasT2", "evalAtlas", "Build importer", "Batch importer for legacy customer records.", "in-progress", 12),
  task("evalAtlasT3", "evalAtlas", "Write docs", "Operator and API documentation.", "todo", 3),
  { id: "evalAtlasRisks", parent: "evalAtlas", title: "Atlas Risks", content: "<p>See the attached risk register. Top risk: data loss during cutover.</p>" },
  task("evalBorT1", "evalBorealis", "Prototype", "Clickable prototype of the mobile flow.", "done", 8),
  task("evalBorT2", "evalBorealis", "User study", "Twelve-participant usability study.", "todo", 10),
  task("evalCasT1", "evalCassini", "Vendor review", "Score the five shortlisted warehouse vendors.", "in-progress", 6),
  task("evalCasT2", "evalCassini", "Pilot rollout", "Pilot at the Lisbon warehouse.", "todo", 20),
  task("evalCasT3", "evalCassini", "Training", "Train warehouse staff on the new vendor system.", "todo", 4),

  { id: "evalMaria", parent: "evalPeople", title: "Maria Santos", content: "<p>Location: Lisbon. Team: Platform. Started: 2021.</p>" },
  { id: "evalChen", parent: "evalPeople", title: "Chen Wei", content: "<p>Location: Taipei. Team: Research. Started: 2023.</p>" },
  { id: "evalMeetKick", parent: "evalMeetings", title: "2025-03-04 Atlas kickoff",
    content: "<p>Attendees: Maria Santos, Chen Wei.</p><p>Decision: use PostgreSQL 16 for Atlas.</p><p>Action: Chen to deliver the schema review by 2025-03-18.</p>" },
  { id: "evalMeetPause", parent: "evalMeetings", title: "2025-04-18 Borealis pause",
    content: "<p>Borealis paused because of a funding freeze.</p><p>Decision: revisit in Q1 2026.</p><p>Budget spent so far: 9,200 USD.</p>" },
  { id: "evalRetry", parent: "evalRef", title: "retry.py", type: "code", mime: "text/x-python", content: "MAX_RETRIES = 3\nBACKOFF_SECONDS = 2\n" },
  { id: "evalGlossary", parent: "evalRef", title: "Glossary", content: "<p>SLA: service level agreement. Uptime target: 99.9%.</p>" }
];

const RISKS_CSV = `id,risk,severity,owner
R1,Data loss during cutover,high,Maria Santos
R2,Schema drift in legacy exports,medium,Chen Wei
R3,Importer throughput below target,low,Maria Santos
`;

async function exists(id: string): Promise<boolean> {
  try {
    await api("GET", `/notes/${id}`);
    return true;
  } catch (e) {
    if (e instanceof EtapiError && e.status === 404) return false;
    throw e;
  }
}

async function clean() {
  if (!(await exists("evalRoot"))) return console.error("Nothing to clean: evalRoot not found.");
  await api("DELETE", "/notes/evalRoot");
  console.error("Deleted Eval Sandbox (soft-deleted; Trilium erases it later or via undelete_note).");
}

async function seed() {
  if (await exists("evalRoot")) throw new Error("evalRoot already exists. Run with --clean first.");

  for (const n of NOTES) {
    await api("POST", "/create-note", {
      noteId: n.id, parentNoteId: n.parent, title: n.title, type: n.type ?? "text", mime: n.mime, content: n.content ?? ""
    });
    for (const [type, name, value] of n.attrs ?? []) {
      await api("POST", "/attributes", { noteId: n.id, type, name, value: value ?? "" });
    }
  }

  // Cloned note: Glossary also lives under People
  await api("POST", "/branches", { noteId: "evalGlossary", parentNoteId: "evalPeople" });

  // Attachment on Atlas Risks
  await api("POST", "/attachments", { ownerId: "evalAtlasRisks", role: "file", mime: "text/csv", title: "risk-register.csv", content: RISKS_CSV });

  // Revision history for retry.py: 3 -> 5 -> 7 (snapshots taken at 3 and 5)
  const put = (content: string) =>
    etapiJson("PUT", "/notes/evalRetry/content", { body: content, contentType: "text/plain", signal });
  await api("POST", "/notes/evalRetry/revision");
  await put("MAX_RETRIES = 5\nBACKOFF_SECONDS = 2\n");
  await api("POST", "/notes/evalRetry/revision");
  await put("MAX_RETRIES = 7\nBACKOFF_SECONDS = 4\n");

  console.error(`Seeded ${NOTES.length} notes under evalRoot.`);
}

await (process.argv.includes("--clean") ? clean() : seed());
