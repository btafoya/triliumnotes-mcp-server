---
name: trilium-note-types
description: >-
  How to store content in Trilium Notes with the right note type, MIME type and content format. Use whenever you create, edit, change, update, rewrite, fix or overwrite the content of a Trilium note (trilium_create_note, trilium_set_note_content, trilium_update_note, trilium_create_attachment), including small edits like "change this value in my note", and whenever the user wants to save a code snippet, script, config file, JSON, Markdown, a Mermaid diagram, an image or a file into Trilium or "my notes" with the trilium MCP server connected. Covers which type/mime to pick (text vs code vs markdown vs mermaid vs image), how to format content (HTML for text notes, raw text for code), syntax-highlight languages, and the safety steps before writing. Use it even when the user only says "save this to my notes" or "add a note" and never names a note type.
---

# Storing content in Trilium: type, mime, content format

A Trilium note is **type + mime + content**. The `type` picks the editor and the format the content must be in; the `mime` names the language or format for code. Get these wrong and the note shows up garbled (HTML tags printed as text, no syntax highlighting, a diagram shown as plain text) and fixing it later means a second write. Decide type and mime *before* calling `trilium_create_note`.

## Pick the type

| User wants to save | `type` | `mime` | `content` format |
|---|---|---|---|
| A code snippet, script or config file (alone) | `code` | the language's mime, see [references/mime-types.md](references/mime-types.md) (`text/x-python`, `application/json`, `text/x-sh` ...) | **Raw source text.** No HTML, no escaping, no markdown fence |
| Markdown (README, meeting notes, an answer you wrote in markdown) | `code` | `text/x-markdown` | Raw markdown, kept byte for byte. There is no `markdown` note type |
| Prose with formatting, WYSIWYG note, a note others will edit visually | `text` (default) | `text/html` (default) | **HTML**: `<p>`, `<h2>`, `<ul><li>`, `<strong>`, `<a href>`; escape `&` `<` `>` as `&amp; &lt; &gt;` |
| Code *inside* explanatory prose | `code` + `text/x-markdown` with a fenced block (preferred), or a `text` note with `<pre><code class="language-text-x-python">...</code></pre>` | | |
| A diagram (flowchart, sequence, class, ER ...) | `mermaid` | `text/vnd.mermaid` | Raw Mermaid source (`graph TD ...`), no fence |
| Structured data (JSON, YAML, TOML, CSV-as-text) | `code` | `application/json`, `text/x-yaml`, `text/x-toml`, `text/plain` | Raw text |
| An image | `image` | must start with `image/` (`image/png`) or the server answers 400 `INVALID_MIME_FOR_IMAGE` | Binary: create empty, then `trilium_set_note_content` with `encoding: "base64"` |
| Any other file (PDF, zip ...) | `file` | its real mime (`application/pdf`; default `application/octet-stream`) | Binary via base64, same two steps |
| A file kept *with* a note, not as its own note | use `trilium_create_attachment` on the owner note | | text inline, binary via `trilium_set_attachment_content` base64 |
| A folder / grouping | `book` | none | none; this is the usual container for children |
| A web page | `webView` | none | none; set label `webViewSrc` to the URL |
| A saved search | `search` | none | none; the query lives in a `searchString` label |

Not sure? Prose a human will read and edit in the editor -> `text`. Anything with a syntax or that must survive unchanged -> `code`. If the user hands you Markdown, keep it Markdown; converting to HTML loses the original.

Types `canvas`, `mindMap`, `spreadsheet`, `llmChat` hold JSON owned by Trilium's own editors. Do not author or edit their content by hand: read them, move them, tag them, but let the user change their insides in the app. `launcher`, `doc`, `contentWidget` are internal.

## Rules that prevent the common mistakes

1. **Code is raw text.** For a `code` note put the source exactly as written. Wrapping it in `<pre>`, escaping `<` as `&lt;`, or adding a ```` ``` ```` fence shows those characters literally in the note. (Fences are right only inside a markdown note.)
2. **Text is HTML.** For a `text` note, a literal `<` in your content must be `&lt;` or it is parsed as a tag. Plain `\n` newlines collapse; use `<p>` or `<br>`.
3. **Always set `mime` on code notes.** Omitted, it defaults to `text/plain`: no highlighting. Use the table in the reference file; for a language not listed there use `text/plain` rather than inventing a mime.
4. **JavaScript has three mimes.** `text/javascript` is a plain snippet. `application/javascript;env=backend` and `application/javascript;env=frontend` are **scripts Trilium executes** in the server or the app. Use them only when the user explicitly wants a Trilium script, because a stray one can run on startup or on a schedule.
5. **Highlight class inside text notes** is `language-` plus the mime with every non-alphanumeric run turned into `-`: `text/x-python` -> `language-text-x-python`, `application/json` -> `language-application-json`. (A bare `language-python` is not what Trilium writes.)
6. **Mermaid creation.** Try `trilium_create_note` with `type: "mermaid"`. If the tool's type list rejects it (older server build), create a `code` note with the source, then `trilium_update_note` with `type: "mermaid"` and `mime: "text/vnd.mermaid"`; the content stays as is.
7. **Changing type or mime later** (`trilium_update_note`) does not convert the content. Switching a note from `text` to `code` leaves the HTML in it. Rewrite the content too.
8. **Protected notes** read back as `[protected]` and cannot be changed through ETAPI. Tell the user instead of retrying.
9. **Reading:** `trilium_get_note_content` returns text for text-like mimes and base64 for binary, in pages of 25,000 characters (follow the `offset` hint). Check `trilium_get_note` for type and mime first so you know which you will get.

## Before you write

- **Avoid duplicates.** Before `trilium_create_note`, run `trilium_search_notes` for the same title under the intended parent (for example `note.title = "Retry helper"` with `ancestorNoteId`). If one exists, update it, or ask the user, rather than creating a twin.
- **Snapshot before overwrite.** `trilium_set_note_content` replaces everything. Call `trilium_create_revision` on that note first; it is one cheap call and makes the old content recoverable.
- **Pick the parent deliberately.** Creating under `root` clutters the top level. Ask where it belongs, or use the day note / inbox (see the trilium-workflows skill).
- **Verify once.** After a create, the response shows the stored `type` and `mime`; confirm they match what you intended instead of re-reading the content.

## Examples

Save a Python helper the user pasted:
`trilium_create_note { parentNoteId, title: "retry.py", type: "code", mime: "text/x-python", content: "<the source, verbatim>" }`

Save meeting notes written in markdown:
`trilium_create_note { parentNoteId, title: "2026-11-05 Atlas sync", type: "code", mime: "text/x-markdown", content: "# Atlas sync\n- decided ...\n```sql\nSELECT 1;\n```" }`

Save a flowchart:
`trilium_create_note { parentNoteId, title: "Deploy flow", type: "mermaid", mime: "text/vnd.mermaid", content: "graph TD\n  A[Push] --> B[CI]\n  B --> C[Deploy]" }`

Save a short formatted note:
`trilium_create_note { parentNoteId, title: "Shopping", type: "text", content: "<h2>List</h2><ul><li>milk</li><li>eggs</li></ul>" }`
