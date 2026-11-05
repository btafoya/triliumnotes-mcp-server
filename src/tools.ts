import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { etapi, etapiJson, type FetchBody } from "./api.js";

const CHARACTER_LIMIT = 25_000;

type Kind = "read" | "create" | "update" | "delete";

const ANNOTATIONS = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  create: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  update: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
} as const;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(v === undefined ? "OK" : JSON.stringify(v, null, 2));

// ---- shared field schemas ----
const id = (what: string) => z.string().regex(/^[a-zA-Z0-9_]{4,32}$/).describe(`${what} (4-32 chars of [a-zA-Z0-9_], e.g. 'evnnmvHTCgIn'; 'root' is the root note)`);
// User-facing types accepted by Trilium's ETAPI (the OpenAPI enum is incomplete). Internal types launcher/doc/contentWidget are excluded.
// Markdown is not a type: it is type=code with mime=text/x-markdown.
const NOTE_TYPES = ["text", "code", "file", "image", "search", "book", "relationMap", "render", "noteMap", "mermaid", "webView", "canvas", "mindMap", "spreadsheet", "llmChat"] as const;
const encoding = z.enum(["text", "base64"]).default("text").describe("'text' for plain/HTML/markdown content, 'base64' for binary data");

const isTextual = (ct: string) => /^text\/|json|xml|javascript|svg|yaml|html/i.test(ct);

/** Read a content response; text is paged by characters, binary is returned base64. */
async function readContent(res: Response, offset: number, maxChars: number) {
  const ct = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());
  const textual = isTextual(ct);
  const full = textual ? buf.toString("utf8") : buf.toString("base64");
  const slice = full.slice(offset, offset + maxChars);
  const next = offset + slice.length;
  const more = next < full.length;
  const header = `content-type: ${ct}${textual ? "" : " (base64-encoded)"}; chars ${offset}-${next} of ${full.length}`;
  return text(`${header}${more ? `; more: call again with offset=${next}` : ""}\n\n${slice}`);
}

const body = (content: string, enc: "text" | "base64") =>
  enc === "base64"
    ? { body: Buffer.from(content, "base64") as unknown as FetchBody, contentType: "application/octet-stream" }
    : { body: content, contentType: "text/plain" };

export function registerTools(server: McpServer): void {
  function def<S extends z.ZodObject>(
    name: string,
    title: string,
    description: string,
    kind: Kind,
    inputSchema: S,
    fn: (a: z.infer<S>, signal: AbortSignal) => Promise<ReturnType<typeof text>>
  ) {
    // ponytail: generic S can't flow through registerTool's overloads; one cast here keeps every call site typed
    server.registerTool(
      `trilium_${name}`,
      { title, description, inputSchema: inputSchema as z.ZodObject, annotations: ANNOTATIONS[kind] },
      ((args: z.infer<S>, ctx: { mcpReq: { signal: AbortSignal } }) => fn(args, ctx.mcpReq.signal)) as never
    );
  }

  const page = {
    offset: z.number().int().min(0).default(0).describe("Character offset to start from, for paging long content"),
    max_chars: z.number().int().min(100).max(CHARACTER_LIMIT).default(CHARACTER_LIMIT).describe("Max characters to return")
  };

  // ============ Notes ============

  def("create_note", "Create Note",
    `Create a note under a parent and return {note, branch}. Use trilium_search_notes first to find parentNoteId ('root' works) and to check that a note with the same title does not already exist there.
The type decides how 'content' must be formatted: text = HTML; code = raw text, with 'mime' naming the language (e.g. 'text/x-python', 'application/json'; Markdown is type=code + mime 'text/x-markdown'); mermaid = diagram source; canvas/mindMap/spreadsheet = JSON. If mime is omitted a per-type default is used (text -> text/html, code -> text/plain). image notes need an 'image/*' mime.`,
    "create",
    z.strictObject({
      parentNoteId: id("Parent note ID"),
      title: z.string().min(1).describe("Note title"),
      type: z.enum(NOTE_TYPES).default("text"),
      mime: z.string().optional().describe("Language/format for code notes, e.g. 'text/x-python', 'text/x-markdown'; 'image/png' for images. Defaults per type if omitted."),
      content: z.string().default("").describe("Initial content (HTML for text notes)"),
      notePosition: z.number().int().optional().describe("Order in parent: 10, 20, 30...; use 5 for first, 1000000 for last"),
      prefix: z.string().optional().describe("Branch-specific title prefix"),
      isExpanded: z.boolean().optional(),
      noteId: id("Force a specific noteId (must not exist; leave unset normally)").optional()
    }),
    async (a, signal) => json(await etapiJson("POST", "/create-note", { json: a, signal }))
  );

  def("search_notes", "Search Notes",
    `Search notes with Trilium search syntax. Returns note metadata (not content); use trilium_get_note_content for content.
Examples: "towers tolkien" (fulltext), '"Two Towers"' (exact), "towers #book" (keyword + label), "#todo ~project.title = Foo", "note.dateCreated >= '2025-01-01'".
Archived notes are excluded unless includeArchivedNotes=true.`,
    "read",
    z.strictObject({
      search: z.string().min(1).describe("Trilium search query"),
      fastSearch: z.boolean().default(false).describe("Fulltext matches titles/attributes only, not content"),
      includeArchivedNotes: z.boolean().default(false),
      ancestorNoteId: id("Restrict to this subtree").optional(),
      ancestorDepth: z.string().regex(/^(eq|lt|gt)\d+$/).optional().describe("Depth from ancestor: 'eq1' direct children, 'lt4', 'gt2'"),
      orderBy: z.string().optional().describe("Property or label to sort by: 'title', 'dateModified', 'dateCreated', 'childrenCount', '#myLabel', ..."),
      orderDirection: z.enum(["asc", "desc"]).default("asc"),
      limit: z.number().int().min(1).max(200).default(25).describe("Max results"),
      debug: z.boolean().default(false).describe("Include query-parse debug info")
    }),
    async (a, signal) => {
      const r = await etapiJson<{ results: Array<Record<string, unknown>>; debugInfo?: unknown }>("GET", "/notes", { query: a, signal });
      const results = (r?.results ?? []).map(n => ({
        noteId: n.noteId, title: n.title, type: n.type, mime: n.mime, isProtected: n.isProtected,
        parentNoteIds: n.parentNoteIds, childCount: Array.isArray(n.childNoteIds) ? n.childNoteIds.length : 0,
        dateModified: n.dateModified
      }));
      let out = { count: results.length, results, ...(r?.debugInfo ? { debugInfo: r.debugInfo } : {}) };
      let t = JSON.stringify(out, null, 2);
      // Stay under the limit by returning fewer results
      while (out.results.length > 1 && t.length > CHARACTER_LIMIT) {
        const kept = out.results.slice(0, Math.ceil(out.results.length / 2));
        out = { ...out, count: kept.length, results: kept, truncated: true } as typeof out;
        t = JSON.stringify(out, null, 2);
      }
      return text(t);
    }
  );

  def("get_note", "Get Note",
    "Get note metadata: title, type, mime, attributes, parent/child note and branch IDs, dates. Not the content; use trilium_get_note_content. childNoteIds lets you walk the tree.",
    "read", z.strictObject({ noteId: id("Note ID") }),
    async (a, signal) => json(await etapiJson("GET", `/notes/${a.noteId}`, { signal }))
  );

  def("update_note", "Update Note Metadata",
    "Change a note's title, type or mime (not its content: use trilium_set_note_content). Protected notes cannot be modified through ETAPI.",
    "update",
    z.strictObject({
      noteId: id("Note ID"),
      title: z.string().min(1).optional(),
      type: z.enum(NOTE_TYPES).optional(),
      mime: z.string().optional(),
      utcDateModified: z.string().optional().describe("UTC timestamp 'YYYY-MM-DD HH:mm:ss.SSSZ', e.g. to preserve a migrated note's date"),
      utcDateCreated: z.string().optional().describe("UTC timestamp 'YYYY-MM-DD HH:mm:ss.SSSZ'")
    }),
    async ({ noteId, ...patch }, signal) => json(await etapiJson("PATCH", `/notes/${noteId}`, { json: patch, signal }))
  );

  def("delete_note", "Delete Note",
    "Delete a note and ALL its branches (it disappears from every location in the tree, including its subtree). Recoverable with trilium_undelete_note while it is still in the deleted-notes list. To remove from one location only, use trilium_delete_branch.",
    "delete", z.strictObject({ noteId: id("Note ID") }),
    async (a, signal) => json(await etapiJson("DELETE", `/notes/${a.noteId}`, { signal }))
  );

  def("undelete_note", "Undelete Note",
    "Restore a deleted note. It must have at least one undeleted parent. Find candidates with trilium_get_note_history (canBeUndeleted=true).",
    "update", z.strictObject({ noteId: id("Deleted note ID") }),
    async (a, signal) => json(await etapiJson("POST", `/notes/${a.noteId}/undelete`, { signal }))
  );

  def("get_note_history", "Recent Note Changes",
    "List recent note creations, modifications and deletions, optionally limited to a subtree.",
    "read", z.strictObject({ ancestorNoteId: id("Limit to this subtree (default 'root')").optional() }),
    async (a, signal) => {
      const r = await etapiJson<unknown[]>("GET", "/notes/history", { query: a, signal });
      const all = r ?? [];
      let n = all.length;
      let t = JSON.stringify(all.slice(0, n), null, 2);
      while (n > 1 && t.length > CHARACTER_LIMIT) {
        n = Math.ceil(n / 2);
        t = JSON.stringify(all.slice(0, n), null, 2);
      }
      return text(n < all.length ? `Showing newest ${n} of ${all.length} changes. Narrow with ancestorNoteId.\n${t}` : t);
    }
  );

  def("get_note_content", "Get Note Content",
    "Get a note's content. Text notes return HTML; code notes return raw text; binary notes (image/file) return base64. Long content is paged: pass the offset from the 'more:' hint.",
    "read", z.strictObject({ noteId: id("Note ID"), ...page }),
    async (a, signal) => readContent(await etapi("GET", `/notes/${a.noteId}/content`, { signal }), a.offset, a.max_chars)
  );

  def("set_note_content", "Set Note Content",
    "REPLACE the entire content of a note. Call trilium_create_revision on the note first so the old content is recoverable (skip only for a note you just created). Read the current content before editing so unchanged parts are preserved. Text notes take HTML, code notes raw text.",
    "update",
    z.strictObject({ noteId: id("Note ID"), content: z.string().describe("New content"), encoding }),
    async (a, signal) => json(await etapiJson("PUT", `/notes/${a.noteId}/content`, { ...body(a.content, a.encoding), signal }))
  );

  def("export_note_subtree", "Export Note Subtree",
    "Export a note and its subtree as a ZIP file written to a local path. Use noteId='root' for everything. Protected notes export as '[protected]'.",
    "read",
    z.strictObject({
      noteId: id("Subtree root note ID"),
      format: z.enum(["html", "markdown", "share"]).default("html"),
      output_path: z.string().describe("Absolute local path for the .zip file; an existing file is overwritten")
    }),
    async (a, signal) => {
      if (!isAbsolute(a.output_path)) throw new Error("output_path must be absolute");
      const res = await etapi("GET", `/notes/${a.noteId}/export`, { query: { format: a.format }, signal });
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(a.output_path, buf);
      return text(`Wrote ${buf.length} bytes to ${a.output_path}`);
    }
  );

  def("import_zip", "Import ZIP",
    "Import a local ZIP file (Trilium export format) as a new subtree under a note. Returns {note, branch} of the imported root.",
    "create",
    z.strictObject({ parentNoteId: id("Note to import into"), zip_path: z.string().describe("Absolute local path to a .zip file") }),
    async (a, signal) => {
      if (!isAbsolute(a.zip_path)) throw new Error("zip_path must be absolute");
      const data = await readFile(a.zip_path);
      return json(await etapiJson("POST", `/notes/${a.parentNoteId}/import`, { body: data as unknown as FetchBody, contentType: "application/zip", signal }));
    }
  );

  // ============ Revisions ============

  def("create_revision", "Create Revision",
    "Snapshot the note's current title and content as a revision. Do this before overwriting content you may want back.",
    "create",
    z.strictObject({ noteId: id("Note ID"), format: z.enum(["html", "markdown"]).default("html") }),
    async (a, signal) => json(await etapiJson("POST", `/notes/${a.noteId}/revision`, { query: { format: a.format }, signal }))
  );

  def("list_note_revisions", "List Note Revisions",
    "List a note's revisions (metadata only; protected revisions omitted). Read one with trilium_get_revision_content.",
    "read", z.strictObject({ noteId: id("Note ID") }),
    async (a, signal) => json(await etapiJson("GET", `/notes/${a.noteId}/revisions`, { signal }))
  );

  def("get_revision", "Get Revision",
    "Get revision metadata (title, type, dates, contentLength) by revision ID.",
    "read", z.strictObject({ revisionId: id("Revision ID") }),
    async (a, signal) => json(await etapiJson("GET", `/revisions/${a.revisionId}`, { signal }))
  );

  def("get_revision_content", "Get Revision Content",
    "Get the content of a revision (HTML). Long content is paged.",
    "read", z.strictObject({ revisionId: id("Revision ID"), ...page }),
    async (a, signal) => readContent(await etapi("GET", `/revisions/${a.revisionId}/content`, { signal }), a.offset, a.max_chars)
  );

  // ============ Branches ============

  def("create_branch", "Create Branch (Clone Note)",
    "Place an existing note under another parent (clone; the note then appears in both places). If a branch between the two already exists, it is updated with prefix/notePosition/isExpanded. To create a NEW note use trilium_create_note.",
    "create",
    z.strictObject({
      noteId: id("Child note to place"),
      parentNoteId: id("New parent note"),
      prefix: z.string().optional(),
      notePosition: z.number().int().optional().describe("Order in parent: 10, 20, 30..."),
      isExpanded: z.boolean().optional()
    }),
    async (a, signal) => json(await etapiJson("POST", "/branches", { json: a, signal }))
  );

  def("get_branch", "Get Branch",
    "Get a branch (parent-child link) by branch ID. Branch IDs are listed in a note's parentBranchIds/childBranchIds; they look like '<parentNoteId>_<childNoteId>'.",
    "read", z.strictObject({ branchId: z.string().min(1).describe("Branch ID, e.g. 'root_evnnmvHTCgIn'") }),
    async (a, signal) => json(await etapiJson("GET", `/branches/${a.branchId}`, { signal }))
  );

  def("update_branch", "Update Branch",
    "Change a branch's prefix or notePosition only. To move a note, create a new branch then delete the old one. After repositioning call trilium_refresh_note_ordering so open clients see it.",
    "update",
    z.strictObject({
      branchId: z.string().min(1).describe("Branch ID"),
      prefix: z.string().optional(),
      notePosition: z.number().int().optional()
    }),
    async ({ branchId, ...patch }, signal) => json(await etapiJson("PATCH", `/branches/${branchId}`, { json: patch, signal }))
  );

  def("delete_branch", "Delete Branch",
    "Remove a note from ONE location. If it is the note's last branch the note itself is deleted too. Use trilium_delete_note to delete from everywhere.",
    "delete", z.strictObject({ branchId: z.string().min(1).describe("Branch ID") }),
    async (a, signal) => json(await etapiJson("DELETE", `/branches/${a.branchId}`, { signal }))
  );

  def("refresh_note_ordering", "Refresh Note Ordering",
    "Push changed notePositions of a parent's children to connected clients. Call after trilium_update_branch / create_branch with notePosition.",
    "update", z.strictObject({ parentNoteId: id("Parent note whose children were reordered") }),
    async (a, signal) => json(await etapiJson("POST", `/refresh-note-ordering/${a.parentNoteId}`, { signal }))
  );

  // ============ Attributes ============

  def("create_attribute", "Create Attribute",
    "Add a label (name=value) or relation (name -> target note ID in value) to a note. Names have no whitespace. Examples: label 'todo' value ''; relation 'template' value '<noteId>'.",
    "create",
    z.strictObject({
      noteId: id("Note to attach to"),
      type: z.enum(["label", "relation"]),
      name: z.string().regex(/^\S+$/).describe("Attribute name without whitespace, e.g. 'author'"),
      value: z.string().default("").describe("Label value, or target noteId for relations"),
      isInheritable: z.boolean().optional().describe("Also apply to descendants"),
      position: z.number().int().optional()
    }),
    async (a, signal) => json(await etapiJson("POST", "/attributes", { json: a, signal }))
  );

  def("get_attribute", "Get Attribute",
    "Get an attribute by ID. A note's attributes (with IDs) are included in trilium_get_note.",
    "read", z.strictObject({ attributeId: id("Attribute ID") }),
    async (a, signal) => json(await etapiJson("GET", `/attributes/${a.attributeId}`, { signal }))
  );

  def("update_attribute", "Update Attribute",
    "Labels: only value and position can change. Relations: only position. For anything else delete and recreate.",
    "update",
    z.strictObject({
      attributeId: id("Attribute ID"),
      value: z.string().optional().describe("New value (labels only)"),
      position: z.number().int().optional()
    }),
    async ({ attributeId, ...patch }, signal) => json(await etapiJson("PATCH", `/attributes/${attributeId}`, { json: patch, signal }))
  );

  def("delete_attribute", "Delete Attribute",
    "Delete a label or relation by ID.",
    "delete", z.strictObject({ attributeId: id("Attribute ID") }),
    async (a, signal) => json(await etapiJson("DELETE", `/attributes/${a.attributeId}`, { signal }))
  );

  // ============ Attachments ============

  def("list_note_attachments", "List Note Attachments",
    "List a note's attachments (metadata only). Read data with trilium_get_attachment_content.",
    "read", z.strictObject({ noteId: id("Note ID") }),
    async (a, signal) => json(await etapiJson("GET", `/notes/${a.noteId}/attachments`, { signal }))
  );

  def("create_attachment", "Create Attachment",
    "Create an attachment on a note. 'content' is stored as text as-is; for binary data create without content, then call trilium_set_attachment_content with encoding='base64'.",
    "create",
    z.strictObject({
      ownerId: id("Owner note ID"),
      role: z.string().default("file").describe("Attachment role, usually 'file' or 'image'"),
      mime: z.string().describe("MIME type, e.g. 'application/pdf'"),
      title: z.string().min(1),
      content: z.string().optional().describe("Text content only"),
      position: z.number().int().optional()
    }),
    async (a, signal) => json(await etapiJson("POST", "/attachments", { json: a, signal }))
  );

  def("get_attachment", "Get Attachment",
    "Get attachment metadata (title, mime, role, contentLength) by ID.",
    "read", z.strictObject({ attachmentId: id("Attachment ID") }),
    async (a, signal) => json(await etapiJson("GET", `/attachments/${a.attachmentId}`, { signal }))
  );

  def("update_attachment", "Update Attachment",
    "Change an attachment's role, mime, title or position (not its content).",
    "update",
    z.strictObject({
      attachmentId: id("Attachment ID"),
      role: z.string().optional(),
      mime: z.string().optional(),
      title: z.string().optional(),
      position: z.number().int().optional()
    }),
    async ({ attachmentId, ...patch }, signal) => json(await etapiJson("PATCH", `/attachments/${attachmentId}`, { json: patch, signal }))
  );

  def("delete_attachment", "Delete Attachment",
    "Delete an attachment by ID.",
    "delete", z.strictObject({ attachmentId: id("Attachment ID") }),
    async (a, signal) => json(await etapiJson("DELETE", `/attachments/${a.attachmentId}`, { signal }))
  );

  def("get_attachment_content", "Get Attachment Content",
    "Get an attachment's data. Text types return text; binary types return base64. Long content is paged.",
    "read", z.strictObject({ attachmentId: id("Attachment ID"), ...page }),
    async (a, signal) => readContent(await etapi("GET", `/attachments/${a.attachmentId}/content`, { signal }), a.offset, a.max_chars)
  );

  def("set_attachment_content", "Set Attachment Content",
    "REPLACE an attachment's data. Use encoding='base64' for binary files.",
    "update",
    z.strictObject({ attachmentId: id("Attachment ID"), content: z.string(), encoding }),
    async (a, signal) => json(await etapiJson("PUT", `/attachments/${a.attachmentId}/content`, { ...body(a.content, a.encoding), signal }))
  );

  // ============ Calendar ============

  const calendar = (name: string, title: string, path: (v: string) => string, arg: z.ZodString, what: string, created = true) =>
    def(name, title, `${what}${created ? " Created if it doesn't exist." : ""} Returns the note (use its noteId as a parent for new notes).`, created ? "create" : "read",
      z.strictObject({ value: arg }),
      async (a, signal) => json(await etapiJson("GET", path(a.value), { signal }))
    );

  calendar("get_inbox_note", "Get Inbox Note", v => `/inbox/${v}`,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD (used only if the inbox is a day note)"),
    "Get the inbox note where new notes should be dropped (note labelled #inbox, else today's day note; root if neither exists).", false);
  calendar("get_day_note", "Get Day Note", v => `/calendar/days/${v}`,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD"), "Get the journal day note for a date.");
  calendar("get_week_first_day_note", "Get Week-Start Day Note", v => `/calendar/week-first-day/${v}`,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Any date in the week, YYYY-MM-DD"), "Get the day note for the first day of the week containing a date.");
  calendar("get_week_note", "Get Week Note", v => `/calendar/weeks/${v}`,
    z.string().regex(/^\d{4}-W\d{2}$/).describe("ISO week YYYY-Www, e.g. '2025-W01'"), "Get a journal week note (needs the enableWeekNote label on the calendar root).");
  calendar("get_month_note", "Get Month Note", v => `/calendar/months/${v}`,
    z.string().regex(/^\d{4}-\d{2}$/).describe("Month YYYY-MM"), "Get a journal month note.");
  calendar("get_year_note", "Get Year Note", v => `/calendar/years/${v}`,
    z.string().regex(/^\d{4}$/).describe("Year YYYY"), "Get a journal year note.");

  // ============ Application ============

  def("get_app_info", "Get App Info",
    "Get Trilium version, DB/sync versions, build info and data directory. Good connectivity check.",
    "read", z.strictObject({}),
    async (_a, signal) => json(await etapiJson("GET", "/app-info", { signal }))
  );

  def("create_backup", "Create Backup",
    "Write a database backup named 'backup-<name>.db' in the server's data directory. Same name overwrites the previous backup.",
    "update", z.strictObject({ backupName: z.string().regex(/^[a-zA-Z0-9_]{1,32}$/).describe("e.g. 'now' -> backup-now.db") }),
    async (a, signal) => json(await etapiJson("PUT", `/backup/${a.backupName}`, { signal }))
  );

  def("get_metrics", "Get Metrics",
    "Instance/database counts (notes, attachments, revisions, branches, attributes, db size). Counts only, no content.",
    "read", z.strictObject({ format: z.enum(["json", "prometheus"]).default("json") }),
    async (a, signal) => {
      const res = await etapi("GET", "/metrics", { query: a, signal });
      return text(await res.text());
    }
  );
}
