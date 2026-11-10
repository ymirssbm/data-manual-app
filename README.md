# Data Manual App

An open-source, browser-based tool for documenting research studies, especially complex ones like EMA and other intensive longitudinal designs. Bring a study in from Wear-IT, REDCap, Qualtrics, a study file or your own CSV. Then generate a codebook (HTML, PDF or Word), a data dictionary, survey flowcharts and a study schedule. You can also edit the surveys and skip logic, and export the study to REDCap, Qualtrics or SurveyJS.

Everything is built on one study JSON spec ([`schema/study.schema.json`](schema/study.schema.json)): every source is translated into it, and every output is generated from it. AI assistants can design and edit studies in the same spec, inside the app or through the [MCP server](docs/ai-and-mcp.md).

No R or other heavy runtime is needed: it runs in the browser. R users can also open it from R or embed it in Shiny with the [datamanual R package](r-package/README.md).

**Try it online, nothing to install:** https://ymirssbm.github.io/data-manual-app/ (everything except API pulls and saved keys, which need the installed app).

> Status: early development.

## Features

- **Import**: live pulls from Wear-IT, REDCap and Qualtrics (browse your Qualtrics surveys, save REDCap projects); `.qsf`, REDCap dictionaries, Wear-IT exports and spec files; any CSV of responses, long or wide.
- **Survey Editor**: questions, blocks, response options and skip logic, with a live SurveyJS form to click through the branching.
- **Codebook**: themeable, collapsible HTML with skip-logic notes, frequency tables, bar plots, histograms, missingness and outlier screens; prints to PDF.
- **Data dictionary**, **study flowcharts** (top to bottom, foldable blocks, minimap, text outline) and **study schedule**.
- **Export**: REDCap data dictionary, Qualtrics `.qsf`, SurveyJS JSON, study spec, and responses as long or wide CSV.
- **AI**: an in-app study generator/modifier, and an MCP server so Claude, ChatGPT, Copilot and others can use these tools directly.
- **Private by design**: runs in your browser, codebooks report aggregates only, and response data is never sent to AI models.

## Run it

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

Then open **Data → Data Import** and load the example study. `npm test -- --run` runs the tests. `npm run build` builds the static app (`web/dist`), the R widget bundle (`r-package/inst/htmlwidgets/lib/app`) and the MCP server (`web/dist-mcp`).

API pulls and the OpenAI-compatible AI option go through the app's local server (`npm run dev` or `npm run preview`), because those services block requests made directly from a browser.

## Connect an AI assistant (MCP)

```bash
cd web && npm run build:mcp
claude mcp add data-manual -- node "$PWD/dist-mcp/data-manual-mcp.mjs" --dir ~/my-study
```

Setup for other apps (Claude Desktop, VS Code, Cursor, ChatGPT and claude.ai) and the full tool list are in [docs/ai-and-mcp.md](docs/ai-and-mcp.md).

## Documentation

Start at [docs/README.md](docs/README.md):

- [Getting started](docs/getting-started.md)
- [Why this exists](docs/why.md)
- [The study spec](docs/study-spec.md)
- [Importing and exporting](docs/import-export.md)
- [Survey Editor](docs/survey-editor.md)
- [Outputs](docs/outputs.md)
- [AI tools and the MCP server](docs/ai-and-mcp.md)
- [Privacy and security](docs/privacy.md)
- [Contributing](docs/contributing.md)
- [Roadmap](docs/ROADMAP.md)

## Contact

Ethan O. Kile ([eok5206@psu.edu](mailto:eok5206@psu.edu)). Questions, bug reports and feature requests are welcome by email or as [GitHub issues](https://github.com/ymirssbm/data-manual-app/issues).

## License

[MIT](LICENSE)
