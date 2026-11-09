# Roadmap

Rough order. Check items off as they land.

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
- [ ] Wear-IT schedule pull (prior `studySchedulePull` used a separate study schedule JSON URL)
- [ ] Remember API tokens between sessions (prior tool used the system keyring)
- [ ] Qualtrics / REDCap direct API pull (needs the CORS/token decision)
- [ ] AI study generator/modifier
- [ ] Screenshots per item (spec has `screenshotsURL`)
- [ ] Missingness codes and ICC (prior tool had per-participant missingness ICC)

## Phase 2: New features
- [x] PDF output via print-optimized codebook ("Save as PDF")
- [x] Study schedule display: event cards, typical-day view, study timeline
- [x] REDCap data dictionary translator (forms, sections, field types, simple branching logic)
- [ ] SurveyJS manual survey builder, synced both ways with the spec
- [ ] In-app editing of study metadata (authors, funding, abstract) for imported surveys
- [ ] CSV/Excel response-data import to attach `data` to a spec

## Phase 3: Distribution
- [ ] GitHub Pages deployment of the standalone app
- [ ] `r-package/` htmlwidget wrapper + Shiny bindings (trim widget bundle: Mermaid makes it 5.7 MB)
- [ ] Contributor guide for adding translators and generators
