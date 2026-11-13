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

## Repeating and floating blocks

Two optional fields describe blocks that aren't simply asked once, in place:

- `Block.Repeat` asks the block more than once in one delivery:
  - `{"Type": "Fixed", "Count": 3}`: three times;
  - `{"Type": "Per.Answer", "Source.Item.ID": "ev_substances"}`: once for each option chosen in a multiple-select question (e.g. once per substance used);
  - `{"Type": "Until", "Stop.Item.ID": "more", "Stop.Value": "0", "Count": 5}`: again until an answer says stop, at most 5 times.

  Each answer's repetition is recorded in the data's `Iteration` column (and, for `Per.Answer`, the option it was about in `Iteration.Key`).
- `Block.Float` makes a block floating: `{"Surveys": ["morning", "random", "evening"], "Once.Per": "Day"}`. The block is defined in the first survey listed and asked once a day (or once per `Burst` or `Study`) in the first of those surveys the participant actually takes. If they miss the morning survey, it moves to the momentary check, and so on. The data's `Survey.Name` column records where it was answered.

## Interventions (JITAI)

- `Survey.Role: "Intervention"` marks a survey that delivers content (a message, prompt or activity) rather than measuring. Omitted means an assessment.
- A schedule window's `Intervention.Options` makes it a decision point: one option is picked at random with the given probabilities, e.g. `[{"Survey.Name": "coping_tip", "Probability": 0.5, "Label": "Coping tip"}, {"Survey.Name": null, "Probability": 0.5, "Label": "No message"}]`. With `Trigger.Info`, the draw happens only when the rule is met (e.g. evening craving ≥ 70), which describes a micro-randomized trial.

## Schedules and study days

A schedule's dates are an example: what matters is the spacing between windows and their recurrence rules. Day 1 is the first day any window starts, and each participant's day 1 is their own start. When everyone starts on the same weekday, the schedule's `extensions` can say so (`"Study.Day1.Weekday": "MO"`), and study days then map to days of the week (the calendar shows weekdays and weekends, and `byDay` rules line up).

## Response data

`data` holds one array per column, all the same length, one position per delivered question:

| Column | Example |
| --- | --- |
| `Participant.ID` | `P001` |
| `Session.ID` | `17` (one survey sitting) |
| `Survey.Date.Completed` | `2026-02-02T20:37:00-05:00` (ISO 8601 with offset) |
| `Question.ID` | `ev_mood` |
| `User.Response` | `62`; empty when delivered but not answered |
| `Survey.Name` (optional) | `random`: the survey whose delivery the answer came from (needed for floating blocks) |
| `Iteration` (optional) | `2`: which repetition of a repeating block; null otherwise |
| `Iteration.Key` (optional) | `"3"`: for per-answer repeats, the option the repetition was about |

Optional columns cover device, timezone, app version, network and more. A survey someone never answered still appears, as empty responses for the questions everyone is shown, so response rates in the codebook reflect real adherence.

## Validation

The app (and the MCP server's `save_study` and `validate_study` tools) checks every study:

1. **Schema**: required fields, types, allowed values (Ajv, JSON Schema 2020-12).
2. **Cross-references**: every `Parent`, skip-logic target and schedule survey must exist; a repeating block's source or stop question must be in its survey; a floating block's surveys must exist, starting with its own; an intervention option must name a real survey (and the probabilities should add up to 1).

Errors block the study from loading; warnings are listed on Home. TypeScript types for the spec are generated from the schema (`npm run gen:types` in `web/`).
