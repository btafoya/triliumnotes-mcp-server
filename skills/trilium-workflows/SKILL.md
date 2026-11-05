---
name: trilium-workflows
description: >-
  Task recipes and safety rules for working with a Trilium Notes instance through the trilium MCP server beyond plain create/search - journal and day notes, the inbox, organizing the tree (move, clone, reorder), labels and relations, attachments, revisions and recovering lost content, deleting and undeleting, ZIP export/import, backups. Use when the user wants to log something to today's journal, capture to the inbox, move or reorganize notes, tag notes, attach a file, restore an old version, undo a delete, export a subtree or back up Trilium, or asks for any multi-step change that touches several notes.
---

# Trilium workflows

Tool names below are the `trilium_*` MCP tools. For which `type`/`mime` to give a new note, follow the trilium-note-types skill; for finding notes, trilium-search.

## Capture and journal

- **Quick capture:** `trilium_get_inbox_note` (pass today's date) returns the note new items belong in: the `#inbox`-labelled note if the user has one, otherwise today's day note, otherwise `root`. Create the new note under that ID. If it comes back as `root`, tell the user the instance has no inbox or journal configured and ask where to put it instead of cluttering the top level.
- **Journal entry:** `trilium_get_day_note` (`YYYY-MM-DD`) returns *and creates if missing* the day note. On a database with no journal it also creates the whole Calendar tree (year, month, day) as a side effect. So call it when the user actually wants a journal entry, never as a probe. Week (`YYYY-Www`), month (`YYYY-MM`) and year (`YYYY`) variants work the same; week notes need the `enableWeekNote` label on the calendar root.
- Append rather than replace: read the day note's content, add your block, write it back (with a revision first, see below).

## Organize the tree

- A note can live in several places. Each placement is a **branch** (`parentNoteId` + `noteId`); `trilium_get_note` lists `parentBranchIds` and `childBranchIds`.
- **Clone** a note into another folder: `trilium_create_branch { noteId, parentNoteId }`. The note now appears in both and edits show in both.
- **Move** = clone to the new parent, then `trilium_delete_branch` on the *old* branch. Never move by delete + recreate: that loses ids, links, revisions and attributes.
- **`trilium_delete_branch` removes one placement**, and deletes the note too only if that was its last. **`trilium_delete_note` removes it everywhere**, including its whole subtree. Pick deliberately: for "remove it from this folder", use the branch.
- **Reorder:** `trilium_update_branch { branchId, notePosition }` (10, 20, 30 ...; 5 = first), then `trilium_refresh_note_ordering { parentNoteId }` so open clients update.
- Rename / retype: `trilium_update_note`. This changes metadata only, never content.

## Labels and relations (attributes)

- A **label** is `name = value` (`status = active`, or a bare flag like `todo`). A **relation** points at another note: `name` with the target `noteId` as the value (`owner -> <noteId>`).
- `trilium_create_attribute { noteId, type: "label" | "relation", name, value, isInheritable? }`. Names cannot contain spaces. `isInheritable: true` applies it to all descendants, so use it sparingly.
- `trilium_update_attribute` can change a label's `value` and `position`, a relation's `position` only. To change a relation's target or any name, delete the attribute and create a new one.
- Attribute IDs come from `trilium_get_note` (`attributes` array). Check for an existing label before adding a duplicate.
- Useful system labels: `#inbox` (capture target), `#archived` (hidden from search), `#sorted`, `#webViewSrc` (URL for a webView note), `~template` (note template).

## Attachments

- Attachments belong to a note and are not tree nodes. Create text inline: `trilium_create_attachment { ownerId, mime, title, content }`. For binary, create it without `content`, then `trilium_set_attachment_content` with `encoding: "base64"`.
- Choose a **note** (type `file`/`image`) when the item should be findable, linkable and movable on its own; choose an **attachment** for supporting material that belongs to one note.
- List with `trilium_list_note_attachments`, read with `trilium_get_attachment_content` (base64 for binary).

## Revisions and recovery

- `trilium_create_revision { noteId }` snapshots the current title and content. **Do it before any overwrite** (`trilium_set_note_content`) or large edit.
- `trilium_list_note_revisions` returns them newest first (metadata only); `trilium_get_revision_content` reads one. To restore, read the revision's content and write it back with `trilium_set_note_content` (after a fresh revision of the current state).
- `trilium_get_note_history` shows recent creations, edits and deletions across a subtree: the way to answer "what changed" or find something that was just deleted.
- **Deletion is soft.** `trilium_undelete_note` restores a deleted note while Trilium still keeps it (it must have at least one undeleted parent). Find candidates in `trilium_get_note_history` (`canBeUndeleted: true`). Say so when you delete: it is reversible for now, not forever.

## Export, import, backup

- `trilium_export_note_subtree { noteId, format: "html" | "markdown" | "share", output_path }` writes a ZIP to an **absolute local path** and overwrites an existing file there. Use `root` for everything. Protected notes export as `[protected]`.
- `trilium_import_zip { parentNoteId, zip_path }` imports a Trilium-format ZIP as a new subtree under the note. It adds notes; run the duplicate check first if the user may have imported it before.
- `trilium_create_backup { backupName }` writes `backup-<name>.db` in the server's data directory; the same name overwrites the earlier backup. Offer it before bulk changes (mass delete, big import, restructuring many notes).
- `trilium_get_app_info` (version, data dir) and `trilium_get_metrics` (counts) are cheap health checks.

## Guardrails for multi-note changes

1. **Say the plan first** when a request touches more than a few notes (which notes, which change), and get a yes before bulk deletes, mass re-parenting or bulk content rewrites.
2. **Scope by ID, not title.** Resolve names to IDs with trilium-search, show ambiguous matches to the user, and act on IDs.
3. **Revision before overwrite, search before create.** Cheap, and they are what make mistakes recoverable.
4. **Report what changed** with IDs and titles at the end, so the user can find or undo it.
5. **Do not leave test or scratch notes behind.** If you create temporary notes to try something, delete them and say so.
