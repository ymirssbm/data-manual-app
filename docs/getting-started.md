# Getting started

## Open the app

The app runs in a web browser. During development, start it from the `web` folder:

```bash
cd web
npm install
npm run dev        # then open http://localhost:5173
```

This needs [Node.js](https://nodejs.org) 20 or newer. A hosted version that needs nothing installed is on the [roadmap](ROADMAP.md).

API pulls (Wear-IT, REDCap, Qualtrics) and the OpenAI-compatible AI option go through the app's local server, because those services block requests made directly from a browser. They work with `npm run dev` and `npm run preview`.

## Load the example

Go to **Data → Data Import** and click **Recovery Pathways EMA (example study)**. It has three 7-day measurement bursts with morning, evening and weekly surveys, nested and multi-select skip logic, and simulated responses from 200 participants who enrolled over six months and completed about 80% of their surveys.

The study name appears in the top bar once it's loaded. Every page then works on that study.

## The pages

| Page | Use it to |
| --- | --- |
| **Home** | See what's loaded and any validation notes. Download the study as a spec file. |
| **Data → Data Import** | Pull from Wear-IT, REDCap or Qualtrics; open a `.qsf`, REDCap dictionary, Wear-IT export or spec file; or bring your own CSV of responses ("Your dataset" tab). |
| **Data → Data Export** | Download the study for REDCap, Qualtrics or SurveyJS, or the responses as long or wide CSV. |
| **Survey Editor** | Edit questions, blocks and skip logic, and click through the survey as a live form. |
| **Codebook → Generator / Viewer** | Choose sections and a look, preview live, then download HTML or save as PDF. |
| **Data Dictionary → Generator / Viewer** | One row per variable; search and download as CSV. |
| **Study Flowchart** | See each survey's flow and skip logic. Fold blocks, use the minimap, export SVG/PNG, or show a text outline. |
| **Study Schedule** | When each survey is delivered, as event cards, a typical day and a study timeline. |
| **AI Study Generator** | Describe a study in plain language and get a valid spec, or ask for changes to the loaded one. |

**Settings** (bottom left) changes the app's look (light or dark mode, accent color, side panel, text size and font) and lists your saved API keys. **Contact** has the maintainer's details and links for questions and bug reports.

## Your own study

- **From a platform**: Data Import → pick Wear-IT, REDCap or Qualtrics, enter your API details, and pull. See [Importing and exporting](import-export.md).
- **From a file**: Data Import → drop the file on "Upload a File". The format is detected automatically.
- **From a spreadsheet of responses**: Data Import → "Your dataset" tab. Drop the file in, describe the layout (long EMA, wide), map the columns, and either attach it to the loaded study or build a study from the data.
- **From scratch**: AI Study Generator, or Survey Editor → "+ Survey".

## From an AI assistant

Claude, ChatGPT, Copilot and other assistants can use Data Manual's tools directly (design a study, pull data, generate a codebook) through its MCP server. See [AI tools and the MCP server](ai-and-mcp.md).
