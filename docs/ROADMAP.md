# Roadmap

Rough order. Check items off as they land.

## Now (requested 2026-11-09)
- [x] Redesign the Missingness section of codebook descriptives (clear summary instead of run-on text)
- [x] Missingness plots per variable (codebook option)
- [x] Outlier detection plots per numeric variable (codebook option)
- [x] One schema only: every example in the current spec, with example response data; older-format files kept only as translator test fixtures
- [x] Data Pull: REDCap API connection (instrument metadata + records), translated into the spec. Not yet tested against a real project: needs a token
- [x] Data Pull: Qualtrics API connection (survey definition + response export), translated into the spec. Not yet tested against a real survey: needs a token
- [x] Bring your own dataset: upload a CSV, describe its layout (long EMA / wide), map ID, time, question and response columns, and use every tool on it (attach to a loaded study or build a study from the data). Has its own "Your Dataset" page
- [x] Qualtrics: connect once with an account token, browse and search all your surveys, pull with one click
- [x] REDCap: "My REDCap projects" list (one token per project, as REDCap requires), pull with one click
- [x] Codebook TOC redesign (in-document style, foldable nodes, counts, deep levels folded by default)
- [x] Flowchart: survey menu, minimap, foldable blocks (click or collapse/expand all), neutral block styling, fit-to-view per survey
- [x] One example study (branching EMA with simulated data) + its data as a long CSV; other samples moved to test fixtures
- [x] Flowchart flows strictly top to bottom (multi-select branches as yes/no check columns); text outline view; scroll to move, Ctrl+scroll to zoom
- [x] Codebook variable headers: "Delivery • Data type" beside the ID, click the header for descriptives; vertical bar plots; accent-colored charts; more fonts; title page off by default; no outlier table or per-day response plot
- [x] Example data: 200 participants, ~80% adherence, missed surveys recorded as delivered-but-unanswered
- [x] App Settings (dark mode, accent, side panel, text size, font) and Contact panel
- [x] Data Import / Data Export split; exports to REDCap data dictionary, Qualtrics .qsf, SurveyJS JSON, long/wide response CSV (round-trip tested)
- [x] Survey Editor: items, blocks, response options, skip logic; live SurveyJS preview; SurveyJS JSON import/export
- [x] MCP server (stdio + HTTP + optional public tunnel): schema, study, save/validate, import, pull, export, codebook, dictionary, flowchart, schedule, describe_variable
- [x] Documentation in `docs/`
- [ ] Qualtrics "Sign in with Qualtrics" (OAuth): needs each institution's Qualtrics admin to register the app; revisit if a partner institution can
- [ ] REDCap super-token support (admins only) to list every project on a server

## Phase 0: Setup
- [x] Project folder, CLAUDE.md, schema v0.1.0 (neutral branding)
- [x] Install Node.js (26 via fnm)
- [x] Scaffold `web/` (Vite + React + TS + Vitest), with standalone and widget build configs
- [x] Generate TS types from the schema; Ajv validation; cross-reference checks
- [x] Example specs and source files in `examples/`
- [ ] A full real-world example with response data (e.g. the RCC project exported to the spec)
- [ ] R side of the widget: DESCRIPTION, `dataManual()` / `renderDataManual()` wrappers

## Phase 1: Core features (rebuilt and improved)
- [x] Import with auto-detected translators, translator notes, validation report, spec download
- [x] Data dictionary: table, search/filter, CSV export, value=label options, "Shown When" skip logic column
- [x] Survey flowchart: Mermaid, blocks as subgraphs, decision branches, pan/zoom, SVG/PNG export
- [x] Codebook: self-contained HTML, section toggles, TOC, metadata, schedule, flowcharts, skip logic
- [x] Descriptives in codebook: missingness, frequency tables with bars, slider stats + histogram
- [x] Qualtrics translator (.qsf export, also v3 API JSON)
- [x] Older spec format translator (restores blocks missing from surveys)
- [x] UI restyled to match the prior Shiny app; codebook restyled to match the prior R Markdown codebook
- [x] Wear-IT API connector (live pull via local proxy + saved getData JSON import). Not yet tested against a real study: needs a token
- [x] AI study generator/modifier (Claude via the Anthropic SDK, or OpenAI-compatible endpoints)
- [ ] Wear-IT schedule pull (prior `studySchedulePull` used a separate study schedule JSON URL)
- [ ] Screenshots per item (spec has `screenshotsURL`)
- [ ] Missingness codes (study-defined codes like -99 treated as missing)

## Phase 2: New features
- [x] PDF output via print-optimized codebook ("Save as PDF")
- [x] Study schedule display: event cards, typical-day view, study timeline
- [x] REDCap data dictionary translator (forms, sections, field types, simple branching logic)
- [x] Manual survey builder (Survey Editor), synced with the spec; SurveyJS preview and JSON round trip
- [ ] Survey Editor: edit schedules and study metadata; undo/redo; drag-and-drop reordering
- [ ] In-app editing of study metadata (authors, funding, abstract) for imported surveys
- [ ] Excel (.xlsx) dataset upload (CSV/TSV first)

## Phase 3: Distribution
- [ ] GitHub Pages deployment of the standalone app
- [ ] Relay for hosted deployments (Wear-IT, REDCap, Qualtrics, OpenAI-compatible APIs block browser calls)
- [ ] `r-package/` htmlwidget wrapper + Shiny bindings (trim widget bundle: Mermaid makes it 5.7 MB)
- [x] Contributor guide for adding translators, exporters and MCP tools (`docs/contributing.md`)
- [ ] Publish the MCP server to npm (`npx data-manual-mcp`)
- [ ] Verify Qualtrics .qsf and REDCap dictionary exports by importing them into live accounts
