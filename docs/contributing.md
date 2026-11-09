# Contributing

Contributions are welcome, especially translators for other data collection platforms, new exporters, and feedback on the study spec. Open an [issue](https://github.com/ymirssbm/data-manual-app/issues) to discuss larger changes first, or email [eok5206@psu.edu](mailto:eok5206@psu.edu).

## Layout

```
schema/study.schema.json     the study spec (JSON Schema 2020-12)
examples/                    the example study and its responses as CSV
web/                         the app (React + Vite + TypeScript)
  src/core/                  spec types, validation, cross-references, shared model, CSV, time
  src/translators/           source format -> spec
  src/connectors/            live API pulls (Wear-IT, REDCap, Qualtrics)
  src/generators/            spec -> codebook, dictionary, flowchart, schedule, descriptives
  src/exporters/             spec -> REDCap, Qualtrics, SurveyJS, CSV
  src/editor/                Survey Editor operations
  src/ai/                    AI Study Generator
  src/mcp/                   MCP server (tools.ts, server.ts)
  src/components/            the UI
  tests/                     Vitest tests and fixtures
r-package/                   htmlwidget bundle for R/Shiny (in progress)
docs/                        this documentation
```

The rule that keeps it simple: **translators only produce specs, generators and exporters only read specs.** Nothing else knows about any platform's format.

## Develop

```bash
cd web
npm install
npm run dev              # app at http://localhost:5173
npm test -- --run        # tests
npm run typecheck
npm run build            # app, R widget bundle and MCP server
```

## Add a translator (a new source)

1. Create `web/src/translators/<platform>.ts` exporting a `Translator`: `detect()` sniffs a file cheaply, `translate()` returns `{ spec, notes }`. Put anything you approximated or skipped in `notes`.
2. Register it in `web/src/translators/index.ts` (more specific formats before generic ones).
3. Add a fixture under `web/tests/fixtures/` and a test that validates the result.

Because the output is validated against the schema, a translator can be built quickly, including with AI help: the validator says exactly what's wrong. The Qualtrics translator was built this way.

## Add an exporter

1. Create `web/src/exporters/<format>.ts` returning an `ExportResult` (`fileName`, `text`, `mime`, `notes`). Use `surveyLogic()` from `exporters/logic.ts` for skip logic in a platform-neutral form.
2. Add it to `EXPORT_FORMATS` and `exportStudy()` in `exporters/index.ts`; the Data Export page and the MCP `export_study` tool pick it up.
3. Test a round trip: export, read it back with the matching translator, compare questions and skip logic.

## Add an MCP tool

Register it in `web/src/mcp/tools.ts` with a clear description and a zod input schema. Keep the privacy rule: no tool returns response rows. Rebuild with `npm run build:mcp` and run `node scripts/mcp-smoke.mjs <folder>`.

## Style

TypeScript strict mode, Prettier-style formatting, small pure functions in `core/`, `generators/` and `exporters/` (they must run without a DOM, since the MCP server uses them in Node).
