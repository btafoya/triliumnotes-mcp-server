/**
 * Self-check against a local mock ETAPI (no real Trilium needed).
 * Run: bun run build && bun run smoke
 * Set TRILIUM_URL + TRILIUM_ETAPI_TOKEN to run the read-only checks against a real instance instead.
 */
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const LONG = "x".repeat(30_000);
let lastPatch = "";

const mock = createServer((req, res) => {
  const send = (status: number, body: unknown, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (req.headers.authorization !== "tok") return send(401, { status: 401, code: "TOKEN_INVALID", message: "bad token" });
  const url = new URL(req.url!, "http://x");
  let data = "";
  req.on("data", c => (data += c));
  req.on("end", () => {
    const p = url.pathname;
    if (p === "/etapi/app-info") return send(200, { appVersion: "0.99.0" });
    if (p === "/etapi/notes" && req.method === "GET") {
      assert.equal(url.searchParams.get("search"), "hello");
      return send(200, { results: [{ noteId: "abcd1234", title: "Hello", type: "text", childNoteIds: ["c1"], parentNoteIds: ["root"] }] });
    }
    if (p === "/etapi/notes/abcd1234/content") return send(200, LONG, "text/html");
    if (p === "/etapi/notes/abcd1234" && req.method === "PATCH") {
      lastPatch = data;
      return send(200, { noteId: "abcd1234", ...JSON.parse(data) });
    }
    send(404, { status: 404, code: "NOTE_NOT_FOUND", message: `Note '${p}' not found` });
  });
});
await new Promise<void>(r => mock.listen(0, "127.0.0.1", r));
const url = process.env.TRILIUM_URL ?? `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
const token = process.env.TRILIUM_ETAPI_TOKEN ?? "tok";
const useMock = !process.env.TRILIUM_URL;

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: "bun",
    args: ["src/index.ts"],
    env: { ...getDefaultEnvironment(), TRILIUM_URL: url, TRILIUM_ETAPI_TOKEN: token }
  })
);

const { tools } = await client.listTools();
// 42 ETAPI operations minus login/logout (token auth only)
assert.equal(tools.length, 40, `tool count: ${tools.length}`);
assert.ok(tools.every(t => t.name.startsWith("trilium_") && t.annotations), "all tools prefixed + annotated");

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0].text;

const info = await client.callTool({ name: "trilium_get_app_info", arguments: {} });
assert.ok(!info.isError, text(info));

if (useMock) {
  const search = await client.callTool({ name: "trilium_search_notes", arguments: { search: "hello" } });
  assert.ok(!search.isError, text(search));
  assert.match(text(search), /abcd1234/);

  const c1 = await client.callTool({ name: "trilium_get_note_content", arguments: { noteId: "abcd1234" } });
  assert.match(text(c1), /more: call again with offset=25000/);
  const c2 = await client.callTool({ name: "trilium_get_note_content", arguments: { noteId: "abcd1234", offset: 25000 } });
  assert.ok(!/more:/.test(text(c2)), "second page is last");

  const upd = await client.callTool({ name: "trilium_update_note", arguments: { noteId: "abcd1234", title: "New" } });
  assert.ok(!upd.isError, text(upd));
  assert.equal(lastPatch, JSON.stringify({ title: "New" }), "noteId must not leak into PATCH body");

  const missing = await client.callTool({ name: "trilium_get_note", arguments: { noteId: "zzzz9999" } });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /NOTE_NOT_FOUND.*trilium_search_notes/s);
}

const invalid = await client.callTool({ name: "trilium_get_note", arguments: { noteId: "!!" } });
assert.equal(invalid.isError, true, "bad id must be rejected");

await client.close();
mock.close();
console.error("Smoke test passed");
