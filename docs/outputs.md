# Outputs

Every output is generated from the study spec alone, so it works the same whatever platform the study came from, and before any data has been collected.

## Codebook

The **Codebook** page builds a self-contained HTML codebook and shows it live as you change the options (the options panel on the left starts folded; open it from its rail). The codebook's **Sections** menu lists every section, survey, block and question, folded so you can open just what you need. Download it as HTML, as a **Word** file (.docx), or **Save as PDF**. The print version is its own compact layout: every section expanded, light colors whatever the theme, a two-column contents list, each survey on a new page, charts sized for paper, page numbers and the study title in the margins.

The Word file has the same content as the PDF, as an editable document: Word headings (so the navigation pane and the table of contents work), real tables, and charts and flowcharts as pictures. A long flowchart continues over several pages instead of being shrunk to fit one. Word fills in the table of contents and page numbers when the file opens (it asks to update fields; choose Yes). Google Docs and LibreOffice open it too, but show the table of contents only after you update it there.

Structure:

- **Title page**: the study name, authors, and (if ticked) study metadata (data collection period, participants, devices, timezones).
- **Abstract** and **Executive Summary** (your own text, or an automatic summary of the study; in the automatic one, each survey name links to its section).
- **Funding** and **Contact**, each its own section, from the Study details tab (Contact defaults to the study spec's data-access contact).
- **Study Schedule**: a calendar of when each survey is delivered.
- **Study Adherence** (with response data):
  - *Enrollment over time*: cumulative participants by the date of each person's first completed survey (a "Sisyphus" plot). A bar runs from each participant's first to last completed survey, colored by compliance (the share of their delivered prompts they answered; shown when the data records missed prompts). Hover over a bar for the numbers.
  - *Surveys by day since first survey*: one row per participant, one dot per completed survey, with a shaded curve of surveys per day. In measurement-burst designs the dots are colored by burst (a gap of more than a week starts a new burst). Hover over a burst in the legend to pick it out.
  - *Surveys by day of each burst* (studies with more than one burst): one smoothed curve per burst, all starting from the burst's first day, so bursts can be compared on one chart. Hover over a burst in the legend to highlight it and fade the others.
- **Variable List**: per survey, an optional flowchart, then every question. Blocks are framed panels with their own skip-logic line.
  - a header with the question text, its variable name, and how it was delivered and stored (for example "Multiple Choice • Integer", plus "Conditional" when skip logic applies);
  - click the header to open the skip-logic line ("Shown only if …") and **Descriptives**: frequency table, bar plot, histogram (numeric), missingness (answered/delivered, missed per participant, response rate by participant, missingness ICC) and an outlier screen (box plot with Tukey fences). On the generator's **Content** tab, each of these can be switched off, and so can the parts inside the histogram, missingness, outlier and participation sections (for example, "Participants delivered to" when everyone gets every item). Hovering an option highlights what it controls in the live preview, and the preview keeps open questions, chosen tabs and folded sections as it updates. The **Variables** tab picks which variables go in (search, include or leave out all matches; a survey with none left is left out), the table of contents is its own tick box, and one font is used for the whole codebook. Study details you type and the variables you picked stay put when you edit the survey; loading a different study resets them.
- A table of contents and a "Sections" menu; every section folds.

Options (**Content** tab) switch sections, question types and descriptives on or off. **Appearance** sets the theme (five presets, or your own colors), body and heading fonts (system fonts that work offline, or web fonts), text size, and chart style. Charts use the accent color by default.

The codebook never lists individual responses: tables and plots are aggregates (see [Privacy](privacy.md)).

### Media: logo, your own sections, documents and screenshots

The Codebook page's **Media** tab adds what the study spec doesn't hold:

- **Logo**: shown above the codebook's title.
- **Your sections**: pages you write (a study setup, a protocol summary), with images and videos (a file, or a YouTube, Vimeo or .mp4 link). Choose which section each goes after: any of the codebook's own (Title, Title Page, Abstract, Executive Summary, Funding, Contact, Study Schedule, Study Adherence, Variable List, Attached Documents) or another of your sections. A section placed after one that isn't shown (say, Funding with no funding text) still appears where that section would be. Videos play in the HTML codebook; print and Word show a line naming the video instead.
- **Attached documents**: IRB protocols, consent forms, manuals. They travel inside the HTML codebook in an *Attached Documents* section at the end, each downloadable, with text documents shown in full. Word lists their names. The AI Study Generator can read them too (see [AI tools](ai-and-mcp.md)).
- **Screenshots**: upload images named after their questions (`mo_energy.png`, by Question ID or Item ID) to fill each variable's Screenshot tab. Only uploaded screenshots are shown. The example study comes with made-up ones (drawn phone screens), each captioned as a demonstration.

All of this, with the Study details text and the variables you picked, is saved in this browser for each study (by its name), so it's still there the next time you load that study. **Save into the study file** on the Study details tab writes the authors, funding and abstract into the study itself, so they travel with an exported spec.

## Data dictionary

One row per variable: survey, variable name, question text, delivery type, data type, missingness codes, response range, response options (value = label) and **Shown When** (the skip logic in words). Search it, and download it as CSV.

## Study flowchart

One chart per survey (pick from the menu on the left), drawn top to bottom:

- Questions in order; blocks drawn as panels.
- Decision diamonds right under the question that controls them. Multi-select questions become a column of yes/no checks, one per option, so the flow never doubles back.
- Fold a block into one node by clicking it, or **Collapse all blocks**.
- Click a question for its details beside the chart: ID, type, block, when it's shown, what it leads to, response options and (with data) how often it was answered. **Open in codebook** jumps to that variable in the Codebook, unfolded.
- Scroll to move, Ctrl + scroll (or pinch) to zoom, drag to pan; a minimap shows where you are.
- A survey built from a dataset's columns has no known question order or skip logic, so instead of guessing a straight line, the page says there is no flowchart for it. Set the order and skip logic in the Survey Editor, import the survey's design and attach the data to it, or confirm that the columns are in the order the questions were asked. (In the study spec this is `Survey.Flow.Known: false`.)
- **✎ Edit** turns on editing: edit a question in the side panel, select several (Ctrl/Shift-click or the **Select area** box) to make a block or delete them, draw logic with **↘ Link**, and drag in new or copied questions, blocks and surveys. See [Survey Editor](survey-editor.md#editing-from-the-flowchart-the-codebook-and-the-schedule).
- Export SVG or PNG; **Show text outline** gives an indented text version (copy or download); **Show Mermaid code** gives the source.

## Study schedule

A vertical calendar of the study, in **Day**, **Week** or **Month** view. Each survey window is a labelled card at its time, coloured by survey; when windows overlap, the later one is drawn over the earlier one, shifted right, so both stay readable. Windows with no set time sit in an "Any time" row.

How a survey is timed shows in how it's drawn: fixed windows are solid, **random** windows are striped (the prompt goes out once, at a random time inside the window), and **triggered** windows are dashed, with their rule (e.g. "only if ev_craving ≥ 70"), since they may not happen at all. The month view lists each day's surveys, with a count when one repeats ("Momentary Check ×3"); click a day to open it. Since a schedule's dates are only an example (each participant's own dates differ), the calendar labels days by study day: the day view is headed "Day 7", the week view "Study days 1–7" with a "Day N" over each column, and the month view "Study days 1–27". Tick **By burst** to lay it out by study day only: burst 1 from day 1, then burst 2 from its first day (e.g. day 29), and so on, with the weeks between bursts left out and no example dates.

- Step through the study with the arrows (by default skipping days without surveys), jump to the **Busiest day**, or click any day in the **Study days** strip, which shades each day by how many surveys it has.
- Click a card for its details: window, how it repeats, timing (fixed, participant-set, triggered) and which schedule it belongs to.
- **✎ Edit** turns on editing in the side panel: change or remove a window, add one, or build a whole new repeating survey with its questions. Changes save as you go.
- The **Surveys** list shows each survey's windows and number of prompts; click one to highlight it: its cards get a ring and the rest fade, and in the **Study days** strip its days take its colour while days without it fade.

## Generating outside the app

The MCP server's `generate_codebook`, `generate_data_dictionary`, `survey_flowchart` and `study_schedule` tools produce the same outputs from a folder on your computer. See [AI tools and the MCP server](ai-and-mcp.md).
