# Code note mime types

Use these as the `mime` of a `code` note (and, with `-` for every non-alphanumeric run, as the `language-...` class inside `<pre><code>` in a `text` note). Taken from Trilium's `packages/commons/src/lib/mime_type.ts`. A language that is not here: use `text/plain`.

## Common languages

| Language | mime |
|---|---|
| Plain text (default) | `text/plain` |
| Markdown | `text/x-markdown` |
| GitHub Flavored Markdown | `text/x-gfm` |
| Python | `text/x-python` |
| JavaScript (plain snippet) | `text/javascript` |
| JavaScript, runs in Trilium **backend** | `application/javascript;env=backend` |
| JavaScript, runs in Trilium **frontend** | `application/javascript;env=frontend` |
| JSX | `text/jsx` |
| TypeScript | `application/typescript` |
| TypeScript JSX (TSX) | `text/typescript-jsx` |
| JSON | `application/json` |
| JSON-LD | `application/ld+json` |
| YAML | `text/x-yaml` |
| TOML | `text/x-toml` |
| Properties / .env / .ini style | `text/x-properties` |
| XML | `text/xml` |
| HTML (as source) | `text/html` |
| CSS | `text/css` |
| SCSS / Sass / LESS | `text/x-scss` / `text/x-sass` / `text/x-less` |
| Shell (bash, sh, zsh) | `text/x-sh` |
| PowerShell | `application/x-powershell` |
| Batch file | `application/x-bat` |
| SQL (generic) | `text/x-sql` |
| MySQL / MariaDB / PostgreSQL / MS SQL | `text/x-mysql` / `text/x-mariadb` / `text/x-pgsql` / `text/x-mssql` |
| SQLite | `text/x-sqlite` |
| Go | `text/x-go` |
| Rust | `text/x-rustsrc` |
| C | `text/x-csrc` |
| C++ | `text/x-c++src` |
| C# | `text/x-csharp` |
| Java | `text/x-java` |
| Kotlin | `text/x-kotlin` |
| Scala | `text/x-scala` |
| Swift | `text/x-swift` |
| Objective-C | `text/x-objectivec` |
| Dart | `application/dart` |
| PHP | `text/x-php` |
| Ruby | `text/x-ruby` |
| Perl | `text/x-perl` |
| Lua | `text/x-lua` |
| R | `text/x-rsrc` |
| Julia | `text/x-julia` |
| Elixir / Erlang | `text/x-elixir` / `text/x-erlang` |
| Haskell / OCaml / F# | `text/x-haskell` / `text/x-ocaml` / `text/x-fsharp` |
| Clojure | `text/x-clojure` |
| Vue component | `text/x-vue` |
| Dockerfile | `text/x-dockerfile` |
| Nginx config | `text/x-nginx-conf` |
| Terraform / HCL | `text/x-hcl` |
| Protocol Buffers | `text/x-protobuf` |
| Diff / patch | `text/x-diff` |
| LaTeX | `text/x-latex` |
| CMake | `text/x-cmake` |
| Gherkin (.feature) | `text/x-feature` |
| Trilium log | `text/x-trilium-log` |
| Trilium search query | `text/x-trilium-search` |

## Non-code types and their mimes

| Note type | mime |
|---|---|
| `text` | `text/html` (default) |
| `mermaid` | `text/vnd.mermaid` (`text/mermaid` is also accepted) |
| `image` | `image/png`, `image/jpeg`, `image/svg+xml` ... (must start with `image/`) |
| `file` | the file's real mime; default `application/octet-stream` |
| `relationMap`, `canvas`, `mindMap`, `spreadsheet`, `llmChat` | `application/json` (Trilium-managed) |
| `book`, `search`, `render`, `webView`, `noteMap` | empty |

## Defaults when `mime` is omitted

`text` -> `text/html`; `code` -> `text/plain`; `file` -> `application/octet-stream`; `mermaid` -> `text/vnd.mermaid`; structural types -> empty. `image` has no usable default: always pass an `image/*` mime.

The complete list (about 190 languages) is in Trilium's source: `packages/commons/src/lib/mime_type.ts`, the `MIME_TYPES_DICT_RAW` array.
