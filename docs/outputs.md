# Outputs

Every output is generated from the study spec alone, so it works the same whatever platform the study came from, and before any data has been collected.

## Codebook

**Codebook → Generator** builds a self-contained HTML codebook with a live preview; **Codebook → Viewer** shows it full size. Download it as HTML, as a **Word** file (.docx), or **Save as PDF**. The print version is its own compact layout: every section expanded, light colors whatever the theme, a two-column contents list, each survey on a new page, charts sized for paper, page numbers and the study title in the margins.

The Word file has the same content as the PDF, as an editable document: Word headings (so the navigation pane and the table of contents work), real tables, and charts and flowcharts as pictures. A long flowchart continues over several pages instead of being shrunk to fit one. Word fills in the table of contents and page numbers when the file opens (it asks to update fields; choose Yes). Google Docs and LibreOffice open it too, but show the table of contents only after you update it there.

Structure:

- **Title page** (off by default): study name, authors, study metadata (data collection period, participants, devices, timezones) and funding.
- **Abstract** and **Executive Summary** (your own text, or an automatic summary of the study).
- **Study Schedule**: a calendar of when each survey is delivered.
- **Participation** (with response data):
  - *Enrollment over time*: cumulative participants by the date of each person's first completed survey (a "Sisyphus" plot).
  - *Surveys by day since first survey*: one row per participant, one dot per completed survey, with a shaded curve of surveys per day. In measurement-burst designs the dots are colored by burst (a gap of more than a week starts a new burst).
- **Variable List**: per survey, an optional flowchart, then every question. Blocks are framed panels with their own skip-logic line.
  - a header with the question text, its variable name, and how it was delivered and stored (for example "Multiple Choice • Integer", plus "Conditional" when skip logic applies);
  - click the header to open the skip-logic line ("Shown only if …") and **Descriptives**: frequency table, bar plot, histogram (numeric), missingness (answered/delivered, missed per participant, response rate by participant, missingness ICC) and an outlier screen (box plot with Tukey fences). On the generator's **Content** tab, each of these can be switched off, and so can the parts inside the histogram, missingness, outlier and participation sections (for example, "Participants delivered to" when everyone gets every item). Hovering an option highlights what it controls in the live preview, and the preview keeps open questions, chosen tabs and folded sections as it updates. The **Variables** tab picks which variables go in (search, include or leave out all matches; a survey with none left is left out), the table of contents is its own tick box, and one font is used for the whole codebook. Study details you type and the variables you picked stay put when you edit the survey; loading a different study resets them.
- A table of contents and a "Sections" menu; every section folds.

Options (**Content** tab) switch sections, question types and descriptives on or off. **Appearance** sets the theme (five presets, or your own colors), body and heading fonts (system fonts that work offline, or web fonts), text size, and chart style. Charts use the accent color by default.

The codebook never lists individual responses: tables and plots are aggregates (see [Privacy](privacy.md)).

## Data dictionary

One row per variable: survey, variable name, question text, delivery type, data type, missingness codes, response range, response options (value = label) and **Shown When** (the skip logic in words). Search it, and download it as CSV.

## Study flowchart

One chart per survey (pick from the menu on the left), drawn top to bottom:

- Questions in order; blocks drawn as panels.
- Decision diamonds right under the question that controls them. Multi-select questions become a column of yes/no checks, one per option, so the flow never doubles back.
- Fold a block into one node by clicking it, or **Collapse all blocks**.
- Scroll to move, Ctrl + scroll (or pinch) to zoom, drag to pan; a minimap shows where you are.
- A survey built from a dataset's columns has no known question order or skip logic, so instead of guessing a straight line, the page says there is no flowchart for it. Set the order and skip logic in the Survey Editor, import the survey's design and attach the data to it, or confirm that the columns are in the order the questions were asked. (In the study spec this is `Survey.Flow.Known: false`.)
- Export SVG or PNG; **Show text outline** gives an indented text version (copy or download); **Show Mermaid code** gives the source.

## Study schedule

A vertical calendar of the study, in **Day**, **Week** or **Month** view. Each survey window is a labelled card at its time, coloured by survey; when windows overlap, the later one is drawn over the earlier one, shifted right, so both stay readable. Windows with no set time sit in an "Any time" row.

How a survey is timed shows in how it's drawn: fixed windows are solid, **random** windows are striped (the prompt goes out once, at a random time inside the window), and **triggered** windows are dashed, with their rule (e.g. "only if ev_craving ≥ 70"), since they may not happen at all. The month view lists each day's surveys, with a count when one repeats ("Momentary Check ×3"); click a day to open it.

- Step through the study with the arrows (by default skipping days without surveys), jump to the **Busiest day**, or click any day in the **Study days** strip, which shades each day by how many surveys it has.
- Click a card for its details: window, how it repeats, timing (fixed, participant-set, triggered) and which schedule it belongs to.
- The **Surveys** list shows each survey's windows and number of prompts; click one to highlight it: its cards get a ring and the rest fade, and in the **Study days** strip its days take its colour while days without it fade.

## Generating outside the app

The MCP server's `generate_codebook`, `generate_data_dictionary`, `survey_flowchart` and `study_schedule` tools produce the same outputs from a folder on your computer. See [AI tools and the MCP server](ai-and-mcp.md).
