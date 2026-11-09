# Data Manual App

An open-source, browser-based tool for structured study data documentation. Bring in a study from Wear-IT, Qualtrics, REDCap or a study spec file, and generate a codebook (HTML or PDF), a data dictionary, survey flowcharts and a study schedule, all from one shared study JSON spec. An AI assistant can draft or edit studies in the same spec.

No R or other heavy runtime is needed: it runs in the browser, and can also be embedded in R/Shiny as an htmlwidget.

> Status: early development.

## Run it

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

`npm test -- --run` runs the tests; `npm run build` builds the static app (`web/dist`) and the R widget bundle (`r-package/inst/htmlwidgets/lib/app`).

Wear-IT pulls and the OpenAI-compatible AI option go through the app's local server (`npm run dev` / `npm run preview`), because those services block direct browser requests.

## How it fits together

- `schema/study.schema.json`: the study spec everything is built around.
- `web/src/translators/`: Qualtrics `.qsf`, REDCap data dictionary, Wear-IT, and older spec formats, each converted into the spec.
- `web/src/generators/`: codebook, data dictionary, flowchart, schedule and descriptives, each built only from the spec.
- `web/src/ai/`: the AI Study Generator (Claude via the Anthropic SDK, or any OpenAI-compatible endpoint).
- `examples/`: sample studies in every supported format, used by the tests and the app's example list.

See `CLAUDE.md` for architecture notes and `docs/ROADMAP.md` for what's planned. Contributions of new translators (other survey platforms) and outputs are welcome.

## License

[MIT](LICENSE)
