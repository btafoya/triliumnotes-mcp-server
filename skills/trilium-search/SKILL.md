---
name: trilium-search
description: >-
  How to find notes in Trilium with trilium_search_notes using Trilium's search language: full-text, labels (#name) and relations (~name), note properties (note.type, note.mime, note.title, dates), boolean logic, subtree scoping, ordering and limits. Use whenever the user asks to find, list, look up, filter, count or "what do I have on" something in their Trilium notes, whenever you need a note ID or parentNoteId before reading or writing, and before creating a note to check for duplicates. Also use for questions like "which notes are tagged X", "notes modified this week", "all code notes in Python", "notes under project Y", even when the user does not mention search syntax.
---

# Searching Trilium

`trilium_search_notes` takes one query string in Trilium's search language and returns note **metadata** (id, title, type, mime, parents, child count, modified date). It does not return content or attributes: follow up with `trilium_get_note_content` / `trilium_get_note`. IDs from a search are the input to nearly every other tool, so a precise search first saves calls later.

## Query building blocks

| You want | Query |
|---|---|
| Words anywhere (title, content, attributes), all must match | `rings tolkien` |
| Exact phrase | `"The Lord of the Rings"` |
| Word and a label | `towers #book` (same as `towers AND #book`) |
| Label with a value | `#status = active`, `#priority >= 2` |
| Label value contains / starts / ends | `#genre *=* fan`, `#genre =* fan`, `#genre *= fan` |
| Label absent | `towers #!book` or `not(#book)` |
| Either | `#book OR #article`; group with parentheses: `towers (#genre = fantasy OR #genre = scifi)` |
| Relation target by title | `~owner.title = "Maria Santos"` |
| Relation target by id | `~owner.noteId = evalMaria` |
| Note property | `note.type = code`, `note.mime = 'text/x-markdown'`, `note.title *=* retry`, `note.isArchived = true` |
| Content only | `note.content *=* "TODO"` |
| Regex | `note.content %= '\\d{2}:\\d{2}'` (escape backslashes) |
| Dates (label or property) | `note.dateModified >= TODAY-7`, `#dateNote >= MONTH-1`; units: `NOW`, `TODAY`, `MONTH`, `YEAR` with `+-` offsets |
| By parent / ancestor / child | `note.parents.title = 'Projects'`, `note.ancestors.title = 'Projects'`, `note.children.title = 'Tasks'` |
| Notes linking to / from | `note.links.title = 'Tolkien'`, `note.backlinks.title = ...` |
| Exclude a subtree | `#book AND not(note.ancestors.title = 'Archive')` |

Properties usable after `note.`: `noteId`, `title`, `type`, `mime`, `content`, `dateCreated`, `dateModified`, `isProtected`, `isArchived`, `childrenCount`, `parentCount`, `labelCount`, `relationCount`, `attributeCount`, `contentSize`, `revisionCount`.

Operators: `=` equals, `!=` not equal, `*=*` contains, `=*` starts with, `*=` ends with, `%=` regex, `~=` fuzzy, `<` `<=` `>` `>=` numeric/date. Values with spaces need quotes.

## Using the tool parameters

- **Scope with `ancestorNoteId`** (and `ancestorDepth`: `eq1` direct children, `lt3`, `gt2`) instead of title tricks. This is the fast way to say "inside this project".
- **Order and limit with the parameters** `orderBy` (`title`, `dateModified`, `dateCreated`, `childrenCount`, or a label like `#priority`), `orderDirection`, `limit` (default 25, max 200). Do not also write `orderBy` or `limit` inside the query string.
- **There is no offset.** If you hit the limit, tighten the query (narrower date range, a label, an ancestor) instead of trying to page.
- `fastSearch: true` searches titles and attributes only: quick on big databases, but misses words that only appear in content.
- `includeArchivedNotes: true` to include archived notes (excluded by default).
- Plain words are fuzzy-tolerant for 4+ characters, so `retries` can match `retry`. Use quotes or `=` for exact matches, and combine with `note.type`/labels when the result set is noisy.

**If the search is the first step of a write** (edit, overwrite, create, move, delete), also read the trilium-note-types skill before writing: it holds the snapshot-before-overwrite and duplicate-check rules.

## Habits that keep searches useful

1. **Start narrow, widen on empty.** A zero-result search usually means a too-specific value or wrong label name, not an empty database. Drop one condition at a time, or check how the label is spelled on a known note with `trilium_get_note`.
2. **Resolve names to IDs once.** Search for the parent/project by title, keep its `noteId`, and use it as `ancestorNoteId` or `parentNoteId` afterwards.
3. **Titles are not unique.** If a title search returns several notes, show the user the candidates (title + parent) rather than picking one for a write.
4. **Know what search can't see.** Trilium's internal hidden subtree (`_hidden`: launchers, templates, settings) is not searched; protected notes show `[protected]` titles and cannot be matched on content.
5. **Counting** is `count` in the response, capped by `limit`. For a total over a large subtree set `limit: 200` and say so if it was reached.
6. **Reading is a second step.** Search to get IDs, then `trilium_get_note_content` (check `type`/`mime` first; binary comes back base64).

## Examples

- All Python snippets: `note.type = code AND note.mime = 'text/x-python'`
- Markdown notes touched this week: `note.mime = 'text/x-markdown' AND note.dateModified >= TODAY-7` (orderBy `dateModified`, desc)
- Open tasks of one project: `#status != done` with `ancestorNoteId` = the project's id
- Everything owned by a person: `~owner.title = "Maria Santos"`
- Does a note called "Retry helper" already exist under Reference: `note.title = "Retry helper"` with `ancestorNoteId` = Reference's id, `limit: 5`
