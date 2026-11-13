# AI tools and the MCP server

There are two ways to work with Data Manual through AI:

1. **AI Study Generator** (in the app): describe a study, or a change to the loaded one, and get a validated spec back.
2. **MCP server**: lets your own AI assistant (Claude, ChatGPT, Copilot, Cursor, …) use Data Manual's tools on a folder on your computer.

In both, response data never goes to the model, every result is validated against the schema before it's kept, and the AI disclosure (models and prompts) is recorded in the study's `AI.Information`.

## AI Study Generator

Open **AI Study Generator**, choose a provider (Claude via the Anthropic API, or any OpenAI-compatible endpoint), pick or save your API key (kept in your computer's secure storage, see [Privacy](privacy.md#api-keys)), and chat. Replies that contain a study are validated; if validation fails, the model is shown the errors and asked to fix them, automatically. When the reply changes the loaded study, it lists each change (added, changed or removed surveys, questions, blocks, schedule windows and study details) with the old and new values highlighted; **Before** and **After** flip the list to the study as it was or as it would be. **Apply these changes** applies them as an edit you can undo (Ctrl+Z). "New chat" starts over; the loaded study is the starting point for changes.

Documents attached on the Codebook page's **Media** tab (an IRB protocol, a consent form, a study manual) can go with each request: tick **Let the AI read the attached documents** under the chat box. Claude receives PDFs whole (text and pages); Word and text files are sent as their text to any provider. Other providers can't take PDFs, so the request says which ones were left out.

## MCP server

The [Model Context Protocol](https://modelcontextprotocol.io) is an open standard for connecting AI assistants to tools. Data Manual's MCP server works from a **study folder**: the current study is `study.json` in that folder, and outputs (Codebook.html, DataDictionary.csv, exports) are written next to it.

### Build it

```bash
cd web
npm install
npm run build:mcp      # writes web/dist-mcp/data-manual-mcp.mjs (one self-contained file)
```

### Connect an assistant

**Claude Code**:

```bash
claude mcp add data-manual -- node "/path/to/data-manual-app/web/dist-mcp/data-manual-mcp.mjs" --dir "/path/to/my-study"
```

**Claude Desktop, Cursor, VS Code (Copilot), and other apps with a config file**: add a server entry (the file and key names vary by app):

```json
{
  "mcpServers": {
    "data-manual": {
      "command": "node",
      "args": ["/path/to/data-manual-app/web/dist-mcp/data-manual-mcp.mjs", "--dir", "/path/to/my-study"]
    }
  }
}
```

**Apps that take a URL**: run the server over HTTP and paste `http://localhost:8765/mcp`:

```bash
node web/dist-mcp/data-manual-mcp.mjs --http --dir /path/to/my-study
```

**Web apps (claude.ai, ChatGPT)**: these need a public HTTPS link. With [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed, `--public` opens a temporary link through Cloudflare's free quick tunnels (no account needed) and prints it:

```bash
node web/dist-mcp/data-manual-mcp.mjs --public --dir /path/to/my-study
```

Anyone with that link can use the tools while the server runs, so stop it (Ctrl+C) when you're done. In public mode `pull_data` and `list_saved_keys` are switched off, because they use keys stored on your computer.

### Tools

| Tool | What it does |
| --- | --- |
| `get_study_schema` | Returns the JSON Schema. Assistants read it before writing a study. |
| `get_current_study` | Returns the current study's design (never its response data) and a one-line summary. |
| `save_study` | Validates a whole study and saves it; returns the errors to fix if it's invalid. Keeps existing response data and records the AI disclosure. |
| `validate_study` | Lists every error and warning in the current study. |
| `import_file` | Translates a `.qsf`, REDCap dictionary, Wear-IT export or spec file into the current study. |
| `pull_data` | Pulls from Wear-IT, REDCap or Qualtrics (or lists Qualtrics surveys). Uses keys saved in the app (or environment variables), never keys typed into the chat. |
| `list_saved_keys` | Names of the keys saved on this computer, with platform and server; never the keys. |
| `export_study` | Writes the study for REDCap, Qualtrics, SurveyJS, or responses as CSV. |
| `generate_codebook` | Writes Codebook.html. `include` / `exclude` take the same section names as the app's options (for example `["Title Page"]`, `["Outlier Plots"]`). |
| `generate_data_dictionary` | Writes DataDictionary.csv and returns the first 50 rows. |
| `survey_flowchart` | Lists surveys, or returns one as a text outline or Mermaid code. |
| `study_schedule` | Summarizes when each survey is delivered. |
| `describe_variable` | Aggregate statistics for one question: deliveries, response rate, frequencies or mean/SD/range. |

### API keys for `pull_data`

The MCP server uses the **same saved keys as the app** (saved through Data Import or the AI page, and kept in your computer's secure storage). Ask for a key by name ("pull REDCap with my Sleep study key"); when only one saved key fits, it's used automatically.

Alternatively, set environment variables before starting the server:

| Variable | Platform |
| --- | --- |
| `DATA_MANUAL_WEARIT_TOKEN` | Wear-IT |
| `DATA_MANUAL_REDCAP_TOKEN` | REDCap |
| `DATA_MANUAL_QUALTRICS_TOKEN` | Qualtrics |

Or name any variable with the tool's `token_env` argument. In MCP config files, put them in the server's `env` block. Either way, keys never pass through the AI.

### Example requests

- "Design a 14-day EMA study with a morning sleep survey and an evening mood survey; ask about alcohol only if mood is below 30. Save it and make a codebook."
- "Import ~/Downloads/wellbeing.qsf and export it as a REDCap data dictionary."
- "Pull REDCap project https://redcap.example.edu/api/ and tell me which variables have the lowest response rate."
- "Show me the evening survey's flowchart as an outline."

### Check that it works

`node web/scripts/mcp-smoke.mjs <empty folder>` (add `--http` for HTTP mode) starts the built server, imports the example study, and calls every tool.
