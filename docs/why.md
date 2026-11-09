# Why this exists

## The problem

Shared data is only as useful as its documentation. Someone reusing a dataset, or trying to reproduce a result, needs to know what each variable means, how it was measured, who was asked it, and when.

That used to be easy to write down. A paper reporting "participants completed the PANAS" meant the whole scale, on paper, once. Modern studies rarely work that way:

- **Delivery varies by person and moment.** Ecological momentary assessment (EMA), ambulatory assessment and just-in-time adaptive interventions (JITAIs) prompt people several times a day, on schedules that can depend on time, location or earlier answers.
- **Skip logic is deep.** A follow-up question may only appear if someone chose two specific options on a multi-select question that itself only appears after a "yes" earlier in the survey. Whether a value is *missing* or *never asked* depends on that logic.
- **Measurement details matter.** The same item delivered as a 0-100 slider, a 5-point scale or a subset of a longer scale is not the same measurement.
- **Platforms differ.** REDCap, Qualtrics, Wear-IT and others each store designs and data in their own formats, so documentation tools built for one don't transfer.

Good documentation for these designs takes real time, usually during the busiest parts of a study, and there are few guidelines for what it should include. So it often doesn't get written.

## The approach

The same software that creates this complexity can carry most of the documentation burden. If the study design is captured once, in a structured form, the documents can be generated from it, and regenerated whenever the design changes.

Data Manual does this in three steps:

1. **One spec.** Every study, whatever platform it came from, is translated into a single JSON Schema (the [study spec](study-spec.md)). Because it's a formal schema, a translator's output can be validated automatically, which also makes it practical to write new translators with AI help: the validator says exactly what is wrong.
2. **Generators.** Codebooks, data dictionaries, flowcharts and schedules are generated only from the spec, so they work the same for every source.
3. **Round trips.** Exporters write the spec back out in other platforms' formats, so a study designed or documented here can be run elsewhere.

## Three kinds of documentation

- **Codebook**: for people. What each measure is, how it was delivered, who saw it (skip logic), and descriptive statistics of the responses.
- **Data dictionary**: for analysis code. One row per variable: types, codes, valid ranges, response options and the condition under which it was shown.
- **Data manual**: the umbrella for a study: every codebook and dictionary, plus survey timing, triggering, data-use and regulatory details. The study spec, together with the generated documents, is a step toward a complete data manual.

## Design principles

The generated documents aim to be:

- **Human readable.** Plain HTML and CSV that open without special software. A printout should still carry the important information (the codebook prints to PDF with every section expanded).
- **Machine readable.** Structured, documented formats (JSON, CSV) that analysis code can ingest directly.
- **FAIR.** Findable, Accessible, Interoperable and Reusable (Wilkinson et al., 2016): built to a published schema, with the provenance of items and of AI-assisted changes recorded in the spec.
- **Rich in paradata.** How data was collected (delivery type, timing, skip logic, response rates) matters as much as the values.
- **Shareable without the data.** Codebooks report aggregates only, never individual responses (see [Privacy](privacy.md)).
