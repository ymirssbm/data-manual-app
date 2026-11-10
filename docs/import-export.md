# Importing and exporting

Studies come in through **Data → Data Import** and go out through **Data → Data Export**. In between, they're always the same study spec, so anything imported can be documented, edited, and exported to another platform.

## Import

### Pull from a platform

| Platform | What you need | What comes in |
| --- | --- | --- |
| **Wear-IT** | Study ID, API token, server | The full study design and all responses. |
| **REDCap** | API URL (e.g. `https://redcap.example.edu/api/`) and a project API token | Instruments, fields, branching logic; optionally records. Save several projects under "My REDCap projects" (REDCap issues one token per project). |
| **Qualtrics** | Datacenter ID (e.g. `iad1`) and an API token | Connect once to list and search every survey the token can see; pull the definition and, optionally, responses. |

Keys are saved once in your computer's secure storage (Windows encryption, macOS Keychain or the Linux keyring) and then picked by name; the browser never holds them. "Use once without saving" is there for one-off pulls. Keys are only sent to their own platform, through the app's local server. See [Privacy](privacy.md#api-keys).

### Open a file

Drop a file on "Upload a File". The format is detected automatically:

| File | Where to get it |
| --- | --- |
| Qualtrics `.qsf` | Survey → Tools → Import/Export → Export Survey |
| REDCap data dictionary `.csv` | Project Setup → Data Dictionary → Download the current Data Dictionary |
| Wear-IT getData `.json` | A saved API response |
| Study spec `.json` | This app's own format (also the older pre-`Study.Metadata` layout) |
| SPSS `.sav` / `.zsav`, SAS `.sas7bdat` / `.xpt`, Stata `.dta`, R `.rds` / `.RData` | Response data saved from the statistics package (opens the column mapper, below) |

Anything that can't be carried over exactly (complex REDCap branching, unsupported question types) is listed in the notes after import.

### Your dataset (response CSV, SPSS, SAS, Stata or R)

SPSS (`.sav`, `.zsav`), SAS (`.sas7bdat`, including compressed files, and `.xpt` transport files) Stata (`.dta`, Stata 8 to 18) and R (`.rds` from `saveRDS()`, `.RData`/`.rda` from `save()`; the largest data frame in an `.RData` file is read) files are read in the browser and go to the same column mapper as a CSV, with more filled in:

- **Question text** from each variable's label, and **response options** from its value labels (SPSS, Stata, and R files labelled with haven or labelled) or from R factor levels, so an imported study has the real wording and the labelled choices.
- **Use the variable labels as**: question text (the default), question IDs (for files that keep IDs in the labels and short codes as column names), or not at all.
- **Dates and date-times** from the variables' formats, so a timestamp column needs no conversion.
- **Missing values** as the file defines them (SPSS user-missing values, SAS and Stata missing codes).


Have responses in a spreadsheet? Drop it on the "Your dataset" tab of Data Import (the same place study files go). A CSV or TSV that isn't a REDCap data dictionary opens the column mapper:

1. **Layout**: long (one row per answer, typical for EMA) or wide (one row per survey occasion, one column per question).
2. **Columns** (guessed automatically, then adjustable):
   - **Participant ID**.
   - **Response timestamp**: the date and time each answer was submitted (not the study day or wave). Many formats are understood, including US dates and Unix times, with a timezone you choose for times written without one. Timestamps that can't be read don't stop the import: those rows get the import date, a note names an example value, and timing features (charts by date, time between assessments) won't be accurate for them. A study file whose timestamps aren't proper date-times also loads, with a warning; readable ones are converted.
   - **Survey / form** (optional): which survey each answer belongs to.
   - **Survey occasion** (optional): which answers were given together in one sitting (one prompt, beep or survey completion). Leave it empty when all answers from one sitting share a timestamp; pick a column when the file has one (session, beep, prompt, REDCap event) or when each answer has its own timestamp.
   - Long files: the **question ID** column, an optional **question text** column, and the **response value** column.
3. **Question IDs and text in wide files**: say what the column names and the rows under them hold. For example, column names = question text and row 1 = question IDs, or (Qualtrics CSV) column names = IDs, row 1 = text, row 2 = ignore. This is guessed from the file, and a preview lists each variable's ID and text before you load it. Platform bookkeeping columns (StartDate, Status, Progress, IP address, REDCap's `_complete` columns...) are left out of the questions by default.
4. **Use it**: attach the data to the loaded study (matched by question ID, or by question text when the IDs differ), or build a new study from the data (question types are inferred from the values, and question text is kept).

## Export

Exports are made from the study as currently loaded, including Survey Editor changes.

| Format | Use it for | Notes |
| --- | --- | --- |
| **Study spec (JSON)** | Reopening here, sharing, version control | Includes response data. |
| **REDCap data dictionary (CSV)** | REDCap: Project Setup → Data Dictionary → Upload | One instrument per survey; blocks become section headers; skip logic becomes branching logic (`[ev_used] = 1`, `[ev_substances(1)] = '1'`). Variable names are made REDCap-safe, with a note listing any renames. Schedules aren't part of a data dictionary. |
| **Qualtrics survey (.qsf)** | Qualtrics: Create project → Survey → From a file | One survey per file (or all surveys as blocks of one). Skip logic becomes question display logic; a block's condition is copied onto each question, since Qualtrics has no block-level display logic. Check display logic after import. |
| **SurveyJS (JSON)** | SurveyJS forms, SurveyJS Creator | Blocks become panels and skip logic becomes `visibleIf`. Spec-only details ride along in each element's `dm` property, so a round trip through the Survey Editor keeps them. |
| **Responses, long (CSV)** | Analysis | One row per response: participant, session, time, survey, question, value. |
| **Responses, wide (CSV)** | Analysis, spreadsheets | One row per survey sitting, one column per question. |

The REDCap, Qualtrics and SurveyJS exports are tested by reading them back with the app's own importers and checking that every question and skip-logic link survives.

**Wear-IT** builds studies in its own study builder and has no import file format, so there is no Wear-IT export. Use the study spec or SurveyJS JSON to carry a design across.
