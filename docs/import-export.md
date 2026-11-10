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

Anything that can't be carried over exactly (complex REDCap branching, unsupported question types) is listed in the notes after import.

### Your dataset (response CSV)

Have responses in a spreadsheet? Drop it on the "Your dataset" tab of Data Import (the same place study files go). A CSV or TSV that isn't a REDCap data dictionary opens the column mapper:

1. **Layout**: long (one row per answer, typical for EMA) or wide (one row per survey, one column per question).
2. **Columns**: map participant, time, question and response columns (guessed automatically, then adjustable). Timestamps in many formats are understood, including US dates and Unix times, with a timezone you choose.
3. **Use it**: attach the data to the loaded study, or build a new study from the data (question types are inferred from the values).

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
