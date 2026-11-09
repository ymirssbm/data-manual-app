# Data Manual documentation

Data Manual turns a study (its surveys, questions, skip logic, schedule and response data) into the documentation other people need to understand and reuse it: a codebook, a data dictionary, survey flowcharts and a study schedule. It also moves studies between platforms: bring one in from Wear-IT, REDCap, Qualtrics or a CSV, edit it, and export it to REDCap, Qualtrics or SurveyJS.

Everything is built on **one study spec** (a JSON Schema). Every source is translated into the spec, and every output is generated from it. That single design decision is what makes the rest possible.

## Guides

| Page | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Open the app, load the example, and tour each page. |
| [Why this exists](why.md) | The documentation problem in complex, adaptive studies, and the principles the outputs follow. |
| [The study spec](study-spec.md) | The JSON Schema: surveys, items, blocks, skip logic, schedules and data. |
| [Importing and exporting](import-export.md) | Wear-IT, REDCap, Qualtrics, study files, your own CSV; exports to REDCap, Qualtrics, SurveyJS and CSV. |
| [Survey Editor](survey-editor.md) | Edit questions, blocks and skip logic, and try the survey as a live form. |
| [Outputs](outputs.md) | Codebook, data dictionary, flowcharts and schedule: what each contains and its options. |
| [AI tools and the MCP server](ai-and-mcp.md) | The in-app AI Study Generator, and connecting Claude, ChatGPT or Copilot to Data Manual. |
| [Privacy and security](privacy.md) | Where data goes (and doesn't), API tokens, and what AI tools can see. |
| [Contributing](contributing.md) | Project layout, tests, and how to add a translator, exporter or output. |

The [roadmap](ROADMAP.md) lists what's done and what's next.

## Contact

Created and maintained by **Ethan O. Kile** ([eok5206@psu.edu](mailto:eok5206@psu.edu)). Bug reports and feature requests: [GitHub issues](https://github.com/ymirssbm/data-manual-app/issues).
