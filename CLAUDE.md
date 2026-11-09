# CLAUDE.md

Guidance for Claude (and other coding agents) working in this repository.

## What this project is

**Data Manual App** is a browser-based study data documentation tool written in TypeScript. It needs **no R** and runs in any browser, and optionally inside R/Shiny as an htmlwidget.

Its feature set comes from an earlier R/Shiny tool the user wrote (see "Prior implementation" below), but this is a **rebuild-and-improve, not a straight port**. Wherever the old backend flow, data model handling, or UI can be done better, do it better. Keep the outputs researchers rely on, and rethink how they are produced. When you deviate from the old behavior, say what changed and why.

### Branding: neutral and independent
This project is not tied to any lab, university, or data collection platform. Do not use the names WearItReadR or Wear-IT, or lab/institution affiliations (RTS lab, Penn State), in product names, UI text, the schema, package names, or docs. Platform-specific code lives only inside its own connector (e.g. `connectors/wearit/`) and is named as one data source among many.

Everything is built around a single structured **study JSON spec** ([schema/study.schema.json](schema/study.schema.json), currently v0.1.0). Data sources (Wear-IT, REDCap, Qualtrics, CSV, ...) are converted *into* the spec. Every output (codebook, data dictionary, flowcharts, schedules, PDFs) is generated *from* the spec. The spec is the contract between domains, researchers, and contributors.

It is open source and meant for outside contributors, so code should be readable, modular, and easy to extend with new connectors and outputs.

## Architecture (modeled on trbrick/drawSEM)

drawSEM's pattern is one React + TypeScript codebase, built by Vite into two targets:

1. **Standalone web app**: `npm run dev` / static hosting (e.g. GitHub Pages). This is the primary target.
2. **htmlwidget bundle**: a UMD bundle written directly into `r-package/inst/htmlwidgets/lib/app/`, so R users can embed it in Shiny without Node.

Planned layout (create these as the work happens, not ahead of time):

```
schema/                 Authoritative study JSON Schema (source of truth)
web/                    Vite + React + TypeScript app
  src/core/             Pure TS, no DOM or React: spec types, validation, parsing,
                        cross-reference checks. Must run in Node and in the browser.
  src/connectors/       Source -> spec converters (wearit, redcap, qualtrics, csv).
                        One folder per source, all sharing one connector interface.
  src/generators/       Spec -> output: codebook, data dictionary, flowchart (Mermaid),
                        study schedule, PDF. Pure functions where possible.
  src/components/       React UI. Context-agnostic: never touches Shiny or window globals directly.
  src/adapters/         Host adapters: standalone.ts, widget.ts (Shiny bridge).
  src/main.tsx          Standalone entry
  src/main-widget.tsx   Widget entry
  tests/                Vitest
r-package/              Thin R wrapper: htmlwidgets binding + Shiny helpers only. No business logic.
examples/               Example study specs and data used for tests and demos
docs/                   Design docs (ROADMAP.md, etc.)
```

### Rules that keep this architecture intact
- **Logic lives in TypeScript, never in R.** The R package only passes JSON in and out.
- **`core/` and `generators/` must not import React or touch the DOM**, so they can be reused by a CLI, tests, or a future Node server.
- **Components talk to the host only through an adapter.** Widget mode: R -> JS via `session$sendCustomMessage` / widget `renderValue`; JS -> R via `Shiny.setInputValue`.
- **TypeScript types mirror the schema.** When the schema changes, update the types, validators, and tests together.
- **Connectors produce valid spec JSON.** Validate connector output against the schema (Ajv) in tests.
- The schema can't check cross-references (`Parent`, `Conditional.*.Item.ID`, schedule `Survey.Name`). `core/` must provide explicit checks for these.

## Visual design: match the prior tool
The user wants the look of the prior R tool preserved, with functional improvements. Before changing any UI, compare against it:
- **App:** shinydashboard "blue" skin with a dark sidebar override: 50px top bar (#3c8dbc, logo area #367fa9), 280px sidebar (#1a1d29, active item has a 3px #2563eb left border), content background #ecf0f5, solid-header primary boxes (#3c8dbc header, white 15px title), 22px bold page titles, 2px-border rounded inputs, #3c8dbc buttons with lift-on-hover, tables with a dark gradient header (uppercase), and toast notifications at the bottom right. Menu: Home, Data (Data Import / Data Export), Survey Editor, Codebook (Generator/Viewer), Data Dictionary (Generator/Viewer), Study Flowchart, Study Schedule, AI Study Generator; Settings and Contact buttons pinned to the bottom of the side panel. Light is the default look; Settings (`components/AppSettings.tsx`) adds dark mode, accent presets, a light side panel, text size and font. App colors are CSS tokens on `.dm-app` (`--surface`, `--surface-2/3/4`, `--border-2`, `--accent-soft`, ...): use tokens, never hard-coded light colors, so dark mode keeps working. The flowchart canvas and the SurveyJS preview stay white on purpose.
- **Codebook:** structure follows the prior R Markdown codebook (Title Page / Abstract Page / Effective Summary / Variable List, a card per variable with `[Item ID]`, "Click to view visuals" panels with Frequency Table / Barplot / Missingness / Screenshots tabs). The look comes from a `CodebookTheme` (`generators/codebook.ts`): CSS variables plus `style-*` / `toc-*` / `charts-*` body classes. Presets: Classic (default: navy page, Times New Roman), Light, Paper, Forest, Slate (dark). Charts default to the accent color. Fonts: system fonts (offline) plus Google web fonts (a `<link>` is added only when one is chosen). Each variable is one clickable header (text, `[Item ID]`, "Delivery • Data type"); clicking it opens the Descriptives tabs. The title page is off by default. Codebooks never list individual responses (no outlier table, no participant IDs on box-plot points). Users customize colors, fonts, size, TOC position, layout style and chart style in the generator's Appearance panel with a live preview; settings persist in localStorage. Theme colors are validated (hex only) before going into CSS.
- **Codebook in-page navigation** is handled by the codebook's own inline JS (scrolls its own window, never `scrollIntoView`, which would also scroll a parent page). The app shows codebooks in an iframe served from a **blob: URL** (`components/HtmlFrame.tsx`), never `srcdoc`: under srcdoc, `#anchor` links resolve to the app's URL and load the whole app inside the frame.
- **Data dictionary:** the CSV keeps the original columns (`Survey.LongName, Question.ID, Question.Text, Question.Type.Display.Name, Result.Type, Missingness.Codes, Response.Range, Response.Text`) + `Shown.When`, with `NA` for empty cells. The on-screen viewer is a cleaner presentation of the same rows: readable headings, survey group rows, block divider rows, type pills, value/label response lists, search + survey/type filters, and a column picker.
- **Flowchart:** Mermaid default theme (lavender nodes), question text only by default. Edge labels must stay quoted (`-->|"label"|`), since unquoted labels break on parentheses.
- Never use the prior tool's logos (Wear-IT, Penn State, RTS).

## Data sources: one schema, many inputs
There is ONE schema (`schema/study.schema.json`). Every source is translated into it; nothing downstream reads a source format.
- **Study structure:** translators in `src/translators/` (Qualtrics .qsf / API definition, REDCap data dictionary CSV / API metadata, Wear-IT getData, native spec; `legacy.ts` only for people's old files).
- **Response data:** converters into the spec's long-format `data` block: `redcapRecordsToData`, `qualtricsResponsesToData`, the Wear-IT converter, and `core/dataset.ts` for any CSV/TSV ("bring your own dataset": long or wide layout + a column mapping, then `attachData` to a loaded study or `inferSpecFromData`).
- **Live APIs:** `src/connectors/` (`redcap.ts`, `qualtrics.ts`, `wearit/`). REDCap, Qualtrics and most AI endpoints refuse browser calls, so they go through the dev/preview server relay (`/proxy/http`, allowlist in `vite.config.ts`: REDCap `…/api/`, `*.qualtrics.com/API/v3/`, `…/chat/completions`, https only). Wear-IT uses its own fixed proxy path.
- **Timestamps:** always normalize with `core/time.ts` (`toIsoDateTime`), which handles offsets, DST, US m/d/y and epoch formats.
- **Examples:** the app offers ONE example study, `examples/branching-ema-study.json` (3 surveys, complex branching, simulated data), plus its responses as a long CSV (`examples/branching-ema-data.csv`) for the dataset importer. Every other sample file (Qualtrics, REDCap, Wear-IT, older-format, small specs) lives in `web/tests/fixtures/` for the tests.

## Wear-IT connector
`src/connectors/wearit/`: `fetch.ts` pages through `GET {server}/api/getData/{studyId}?api_token=…` (following `links.next`). `convert.ts` turns pages into a spec (`Block IDs Map` → surveys/blocks, `Survey Response Key` → responseKey, `data[].User Responses` → long-format data; local timestamps get their timezone's DST-correct offset). `questionTypes.ts` holds the 32 Wear-IT type codes. The Wear-IT server sends no CORS headers, so the browser calls `/proxy/wearit/<server>/…`, which the Vite dev/preview server forwards (`vite.config.ts`, two server paths allowed). A static deployment (GitHub Pages) needs its own small proxy for live pulls; saved getData JSON can always be imported as a file.

## Scope

### Core features from the prior implementation (build these first, improving where possible)
- Parse and validate the spec (`parseJsonSpec`)
- Codebook generation to HTML, with the same section toggles (title page, metadata, authors, funding, abstract, per-question-type sections, histograms, missingness, descriptives, bar plots, frequency tables, skip logic, screenshots)
- Data dictionary generation (CSV, plus an in-app table)
- Survey flowchart generation (Mermaid, with pan/zoom and PNG export)
- Smartphone EMA platform API pull (the old tool's primary source; now just one connector)
- Qualtrics -> spec translator
- AI study generator/modifier that writes spec JSON

Known weak spots in the old tool worth fixing, not copying: it is file-based (Data.csv / blockMap.csv / responseKey.csv in the working directory) instead of working from one in-memory spec; the codebook is rebuilt by rendering whole Rmd templates; the AI endpoint is hard-coded; question type support is a fixed enum with unsupported types dropped.

### New features (not in the prior implementation)
- **PDF output** for the codebook and other documents, alongside HTML
- **Study schedule display** built from the spec's `schedules` (JSON-Calendar-style events with rrule recurrence)
- **Survey Editor** (`components/pages/SurveyEditor.tsx`, operations in `src/editor/edit.ts`): our own editor for items, blocks and skip logic, plus a live preview with the MIT SurveyJS form library (`survey-core`/`survey-react-ui`, lazy-loaded). SurveyJS Creator is commercial, so it is NOT bundled; SurveyJS JSON import/export lets people use it alongside
- **More connectors**: REDCap, CSV/Excel, and others contributors add

Before reimplementing a feature, read the relevant file in the prior implementation to learn what it does, then design the best version here. Don't copy known bugs (e.g. the `tolower(x) == "NA"` check in `GenerateCodebook.R` can never match).

## Open design questions: ask the user, don't decide alone
- PDF approach: currently browser print of the codebook HTML (print CSS, "Save as PDF"). Revisit if one-click PDF files are needed (Paged.js / pdf library / headless Chrome)
- Question types the schema enum can't express (REDCap calc/file fields, Qualtrics matrix/rank order). Translators currently skip or approximate them, with a note
- How browser-based connectors handle CORS and API tokens for REDCap/Qualtrics/Wear-IT (direct calls vs. a small optional local proxy/CLI)
- Where AI calls run, and how keys are handled, without a server
- Spec evolution: how to generalize the platform-flavored parts (the question type enum, the `data` block's device fields like Network.Type and App.Version) and how to version changes
- Charting library for codebook plots

## Working norms
- Ask before large or structural changes. Propose a plan first.
- Never commit or push unless explicitly asked.
- Don't create summary or notes files in the repo. Scratch notes go in `Noise files/` (gitignored).
- Keep dependencies light. Users should need only a browser, or Node for development.
- Write tests (Vitest) alongside core, connector, and generator code.
- The user is a researcher who knows the prior R version deeply. When behavior differs from it, say so explicitly.

## Commands
Node 26 via fnm. All commands run from `web/`:

```
npm install
npm run dev            # standalone app at localhost:5173
npm test -- --run      # vitest, once
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + standalone (web/dist) + widget (r-package/inst/htmlwidgets/lib/app) + MCP server
npm run build:mcp      # MCP server only -> web/dist-mcp/data-manual-mcp.mjs (node scripts/mcp-smoke.mjs <folder> tests it)
npm run gen:types      # regenerate src/core/spec.generated.ts after ANY schema change
```

Agent shells may not load the user's PowerShell profile. If `node` isn't found, prefix the command with:
`$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine'); fnm env --shell powershell | Out-String | Invoke-Expression;`

## Current code map
- `src/core/spec.generated.ts`: generated from the schema. Never edit by hand.
- `src/core/spec.ts`: friendly type aliases (`StudySpec`, `Survey`, `Question`, `Schedule`, ...). Import types from here.
- `src/core/validate.ts`: Ajv (draft 2020-12) schema validation, then cross-reference checks. `validateSpec` / `parseSpec` return issues instead of throwing.
- `src/core/crossRefs.ts`: Parent, conditional item IDs, schedule `Survey.Name`, blockMap, and ID uniqueness checks.
- `src/core/model.ts`: derived read model shared by all generators: block membership, skip-logic branches (merged from the parent's `Child.Mappings` AND the child's `Master.Item.ID`, since specs fill these inconsistently), `shownWhen`, `buildBlockMap`. Semantics: `Conditional.Master.Item.ID` sits on the CHILD and names the question that controls it.
- `src/core/csv.ts`: RFC 4180 CSV read/write (no dependency).
- `src/translators/`: source -> spec. One file per source plus a registry in `index.ts` (order = auto-detect priority). Current: Qualtrics `.qsf` (and v3 API JSON), REDCap data dictionary CSV, older flat spec JSON, native spec. Each returns `{ spec, notes }`. Notes tell the user what was skipped or approximated. Never drop information silently.
- `src/generators/`: spec -> outputs, all pure: `dataDictionary` (rows + CSV), `flowchart` (Mermaid text; blocks as subgraphs, gate-chain flow rules), `schedule` (rrule expansion in wall-clock time), `descriptives` (from the long-format `data` block), `codebook` (one self-contained HTML document; print CSS makes it the PDF).
- `src/exporters/`: spec -> other formats, the mirror of translators: REDCap data dictionary, Qualtrics .qsf, SurveyJS JSON (both directions, for the editor), responses as long/wide CSV. `logic.ts` gives skip logic in a platform-neutral form (`own` / `flat` gates). Each exporter is tested by round-tripping through the matching translator.
- `src/mcp/`: the MCP server (`server.ts`: stdio, or HTTP `/mcp` with `--http`, optional `--public` cloudflared quick tunnel; `tools.ts`: the tools). Built by `vite.mcp.config.ts` into one self-contained Node file. Connectors call APIs directly when `window` is undefined (Node). Tools never return response rows; tokens come from `DATA_MANUAL_<SOURCE>_TOKEN` env vars; `pull_data` is dropped in public mode.
- `src/components/`: one page per menu item in `pages/`. `util.ts` lazy-loads Mermaid and rasterizes SVG to PNG.
- `web/tests/fixtures/`: translator test inputs (Qualtrics, REDCap, Wear-IT, older-format, small specs). Add a fixture with every new translator.
- `src/adapters/`: `HostAdapter` interface; standalone and widget (Shiny `input$<outputId>_spec`) implementations.
- `src/main-widget.tsx`: IIFE global `DataManual` with `render(el, x)` / `unmount(el)`, called by `r-package/inst/htmlwidgets/dataManual.js`.
- `docs/`: user and contributor documentation (index at `docs/README.md`). Update it when features change.
- Contact shown in the app and docs: Ethan O. Kile, eok5206@psu.edu (the maintainer's request; this is contact info, not branding).
- The widget build output under `r-package/inst/htmlwidgets/lib/app/` is committed on purpose, so R users never need Node. Rebuild it whenever `web/src` changes.
- All CSS is scoped under `.dm-app` so the widget doesn't restyle a host Shiny page.

## References (internal only; never surface these names in the product)
- Prior implementation (feature reference): https://github.com/ymirssbm/wearitreadr (spec at `inst/schema/0.1.0/study.json`, codebook templates in `inst/Codebook_RMD/`, Shiny app in `R/app.R`)
- drawSEM (architecture reference): https://github.com/trbrick/drawSEM (see `drawsem-web/vite.widget.config.ts`, `inst/htmlwidgets/drawSEM.js`, `R/drawSEM.R`)
- SurveyJS: https://surveyjs.io
