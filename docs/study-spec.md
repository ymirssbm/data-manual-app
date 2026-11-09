# The study spec

[`schema/study.schema.json`](../schema/study.schema.json) is a JSON Schema (draft 2020-12) describing a whole study. Every import is translated into it, every output is generated from it, and the app validates every study against it (plus cross-reference checks the schema can't express).

## Top level

| Field | Contents |
| --- | --- |
| `Study.Metadata` | Name, authors, funding, abstract, data version, CONSORT recruitment details, data provenance. |
| `schedules` | Delivery schedules: events with start/end windows and recurrence rules (daily, weekly, by day), each linked to a survey. |
| `surveys` | The surveys, each with its ordered list of items (`questions`). |
| `blockMap` | A flat index of every item's survey, type and parent block. The app rebuilds it automatically. |
| `data` | Optional response data, stored as parallel column arrays (see below). |
| `AI.Information` | AI disclosure: which models generated or modified the study, and the prompts used. Recorded automatically. |

## Items

Each survey item has:

- `Item.ID`: unique within the survey; how other items refer to it.
- `Question.ID`: the variable name used in data and outputs.
- `Item.Type`: `Question` or `Block`.
- `Question.Type.Display.Name`: how it was delivered: Multiple Choice, Multiple Select, Slider, Multiple Slider, Free Response, Time Picker, Time Scale Slider, Informational Fullscreen (or Block).
- `Data.Type`: `integer`, `numeric`, `character` or null.
- `Parent`: the block it belongs to, or null at the top level. Blocks can nest.
- `responseKey`: value/label pairs (`{"value": "1", "definition": "Yes"}`), or slider end labels.
- `Question.Text`, `Question.Description` and optional extra details.

## Skip logic

Skip logic lives in each item's `Conditional.Info`:

- On the **controlling question**: `Conditional.Child.Mappings` pairs a response option (`Definition`, its label) with the item it opens (`Conditional.Child.Item.ID`). One option can open several items, and several options can open the same item. `Conditional.Fail.Item.ID` names where to go when no branch applies.
- On the **controlled item**: `Conditional.Master.Item.ID` names its controlling question, and `Conditional.Type` with `Conditional.Threshold` gives a comparison (`1` =, `2` <=, `3` >=, `4` <, `5` >, `6` !=), for example "show if stress >= 70".

A block can be the target of a branch, which shows or hides everything in it. The Survey Editor reads and writes both forms for you.

## Response data

`data` holds one array per column, all the same length, one position per delivered question:

| Column | Example |
| --- | --- |
| `Participant.ID` | `P001` |
| `Session.ID` | `17` (one survey sitting) |
| `Survey.Date.Completed` | `2026-02-02T20:37:00-05:00` (ISO 8601 with offset) |
| `Question.ID` | `ev_mood` |
| `User.Response` | `62`; empty when delivered but not answered |

Optional columns cover device, timezone, app version, network and more. A survey someone never answered still appears, as empty responses for the questions everyone is shown, so response rates in the codebook reflect real adherence.

## Validation

The app (and the MCP server's `save_study` and `validate_study` tools) checks every study:

1. **Schema**: required fields, types, allowed values (Ajv, JSON Schema 2020-12).
2. **Cross-references**: every `Parent`, skip-logic target and schedule survey must exist.

Errors block the study from loading; warnings are listed on Home. TypeScript types for the spec are generated from the schema (`npm run gen:types` in `web/`).
