// Data Manual tools for AI assistants (MCP). Same jobs as the app's pages, run from a folder:
// the current study lives in <dir>/study.json, outputs are written next to it.
//
// Privacy: no tool returns participant responses. Data stays on disk; tools report structure,
// counts and aggregate statistics only. API tokens are read from environment variables, so they
// never pass through the AI.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import schema from '../../../schema/study.schema.json';
import { buildBlockMap, flowKnown, isBlock, surveyModels, validateSpec, type StudySpec, type ValidationResult } from '../core';
import { applyAiProvenance, extractSpecJson } from '../ai/studyAi';
import { detectTranslator } from '../translators';
import {
  QUESTION_TYPES,
  CODEBOOK_PRESETS,
  DEFAULT_CODEBOOK_OPTIONS,
  buildStudySchedule,
  dataDictionaryCsv,
  dataOverview,
  describeItem,
  flowchartText,
  generateCodebookHtml,
  generateDataDictionary,
  generateFlowchart,
  hasResponseData,
  indexResponses,
  type CodebookOptions,
} from '../generators';
import { EXPORT_FORMATS, exportStudy, type ExportFormat } from '../exporters';
import { pullRedcap } from '../connectors/redcap';
import { listQualtricsSurveys, pullQualtrics } from '../connectors/qualtrics';
import { pullWearit, WEARIT_SERVERS } from '../connectors/wearit/fetch';
import { wearitPagesToSpec } from '../connectors/wearit/convert';
import { findKey, listKeys } from '../keystore/node';

export interface ToolContext {
  /** Folder holding study.json and generated outputs. */
  dir: string;
  /** Reachable from the internet (public link): tools that use local credentials are left out. */
  isPublic: boolean;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

/** Codebook sections an assistant can include or exclude, mapped to the generator's options. */
const SECTION_KEYS: Record<string, keyof CodebookOptions | Array<keyof CodebookOptions>> = {
  'Title Page': ['nameOfStudy', 'authors', 'studyMetadata'],
  'Name of Study': 'nameOfStudy',
  Authors: 'authors',
  'Study Metadata': 'studyMetadata',
  Funding: 'funding',
  Contact: 'contact',
  Logo: 'logo',
  'Your sections': 'customSections',
  'Attached documents': 'attachments',
  Abstract: 'abstract',
  'Executive Summary': 'executiveSummary',
  'Study Schedule': 'studySchedule',
  'Study Adherence': ['participationPlots', 'partEnrollment', 'partTimeline', 'partBurstDensity'],
  'Participation Plots': ['participationPlots', 'partEnrollment', 'partTimeline', 'partBurstDensity'],
  'Surveys by day of each burst': 'partBurstDensity',
  'Enrollment over time': 'partEnrollment',
  'Surveys by day since first survey': 'partTimeline',
  'Survey Flowcharts': 'flowcharts',
  'Variable Pages': ['deliveryType', 'typeOfData', 'responseOptions', 'skipLogic', 'frequencyTable', 'barPlot', 'histograms', 'missingness', 'outlierPlots', 'screenshots'],
  'Way question was delivered': 'deliveryType',
  'Type of data': 'typeOfData',
  'Response options': 'responseOptions',
  'Skip Logic': 'skipLogic',
  'Frequency Table': 'frequencyTable',
  'Bar Plot': 'barPlot',
  Histograms: 'histograms',
  'Histogram summary statistics': 'histStats',
  'Histogram chart': 'histChart',
  'Missingness Page': 'missingness',
  'Answered / delivered': 'missAnswered',
  'Missing count': 'missMissing',
  'Participants delivered to': 'missParticipants',
  'Missingness ICC': 'missIcc',
  'Missing per participant table': 'missPerPerson',
  'ICC explanation note': 'missNote',
  'Outlier Plots': 'outlierPlots',
  'Outlier summary': 'outlierSummary',
  'Box plot': 'outlierPlot',
  Screenshot: 'screenshots',
};
const SECTION_NAMES = [...Object.keys(SECTION_KEYS), ...QUESTION_TYPES] as string[] as [string, ...string[]];

export function codebookOptions(include: string[] = [], exclude: string[] = []): CodebookOptions {
  const o: CodebookOptions = { ...DEFAULT_CODEBOOK_OPTIONS, dataTypes: [...DEFAULT_CODEBOOK_OPTIONS.dataTypes] };
  const apply = (name: string, on: boolean) => {
    if ((QUESTION_TYPES as readonly string[]).includes(name)) {
      o.dataTypes = on ? [...new Set([...o.dataTypes, name])] : o.dataTypes.filter((t) => t !== name);
      return;
    }
    const keys = SECTION_KEYS[name];
    for (const k of Array.isArray(keys) ? keys : keys ? [keys] : []) (o as unknown as Record<string, boolean>)[k] = on;
  };
  include.forEach((n) => apply(n, true));
  exclude.forEach((n) => apply(n, false));
  return o;
}

export function registerTools(server: McpServer, ctx: ToolContext): void {
  const studyFile = join(ctx.dir, 'study.json');
  const out = (name: string) => join(ctx.dir, name);

  const readStudy = (): StudySpec | null => {
    if (!existsSync(studyFile)) return null;
    const r = validateSpec(JSON.parse(readFileSync(studyFile, 'utf8')));
    return r.spec;
  };
  const needStudy = () => {
    const spec = readStudy();
    if (!spec) throw new Error(`No study yet in ${ctx.dir}. Import one (import_file / pull_data) or write one (save_study).`);
    return spec;
  };
  const issuesText = (r: ValidationResult) =>
    r.issues
      .filter((i) => i.severity === 'error')
      .slice(0, 40)
      .map((i) => `${i.path || '/'}: ${i.message}`)
      .join('\n');
  const writeStudy = (spec: unknown) => writeFileSync(studyFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  const summary = (spec: StudySpec) => {
    const ov = dataOverview(spec);
    const surveys = spec.surveys.map((s) => `${s['Survey.Name']} (${(s.questions ?? []).filter((q) => !isBlock(q)).length} questions)`).join(', ');
    return `"${spec['Study.Metadata']['Study.Name']}": ${spec.surveys.length} survey(s): ${surveys}.${
      ov ? ` Response data: ${spec.data?.['Question.ID']?.length ?? 0} responses from ${ov.participants} participants, ${ov.firstDate} to ${ov.lastDate}.` : ' No response data.'
    }`;
  };
  const guard = <A,>(fn: (a: A) => Promise<ReturnType<typeof text>> | ReturnType<typeof text>) => async (a: A) => {
    try {
      return await fn(a);
    } catch (e) {
      return fail((e as Error).message);
    }
  };

  // ---------- Study design ----------
  server.registerTool(
    'get_study_schema',
    {
      title: 'Get the study schema',
      description:
        'Return the study JSON Schema. Read this before writing or modifying a study. Use only fields the schema defines; every survey item needs Item.ID, Item.Type and Parent; skip logic lives in Conditional.Type/Conditional.Values/Children.',
    },
    () => text(JSON.stringify(schema)),
  );

  server.registerTool(
    'get_current_study',
    {
      title: 'Get the current study',
      description: 'Return the current study (study.json) without its response data, plus a one-line summary. Read it before modifying.',
    },
    guard(() => {
      const spec = readStudy();
      if (!spec) return text(`No study exists yet in ${ctx.dir}.`);
      const { data: _data, ...design } = spec as StudySpec & Record<string, unknown>;
      void _data;
      return text(`${summary(spec)}\n\n${JSON.stringify(design, null, 2)}`);
    }),
  );

  server.registerTool(
    'save_study',
    {
      title: 'Validate and save a study',
      description:
        'Validate a full study JSON against the schema and save it as the current study. If invalid, returns the errors so you can fix them and call save_study again. Always send the WHOLE study. Existing response data is kept; the AI disclosure and prompts are recorded automatically.',
      inputSchema: {
        study_json: z.string().describe('Complete study JSON object (code fences are fine).'),
        prompt: z.string().describe("The user's request that produced this study or change."),
        model: z.string().describe('Name of the AI model you are (for the AI disclosure).'),
        mode: z.enum(['generate', 'modify']).optional().describe('New study, or a change to the current one (default: modify if a study exists).'),
      },
    },
    guard(({ study_json, prompt, model, mode }) => {
      const raw = extractSpecJson(study_json) ?? (() => {
        try {
          return JSON.parse(study_json);
        } catch {
          return null;
        }
      })();
      if (!raw) return fail('No JSON object found (it may be cut off).');
      const base = (mode ?? (existsSync(studyFile) ? 'modify' : 'generate')) === 'modify' ? readStudy() : null;
      const r = validateSpec(applyAiProvenance(raw, base, prompt, model));
      if (!r.valid || !r.spec) return fail(`INVALID, not saved. Fix these and call save_study again:\n${issuesText(r)}`);
      writeStudy(r.spec);
      return text(`Valid. Saved to ${studyFile}. ${summary(r.spec)}`);
    }),
  );

  server.registerTool(
    'validate_study',
    {
      title: 'Check the current study',
      description: 'Validate the current study and list every error and warning (schema and cross-references such as missing Parents or skip-logic targets).',
    },
    guard(() => {
      if (!existsSync(studyFile)) return text(`No study exists yet in ${ctx.dir}.`);
      const r = validateSpec(JSON.parse(readFileSync(studyFile, 'utf8')));
      const lines = r.issues.map((i) => `${i.severity.toUpperCase()} ${i.path || '/'}: ${i.message}`);
      return text(r.valid ? `Valid.${lines.length ? `\n${lines.join('\n')}` : ''}` : `Not valid:\n${lines.join('\n')}`);
    }),
  );

  // ---------- Import and export ----------
  server.registerTool(
    'import_file',
    {
      title: 'Import a study file',
      description:
        'Translate a local file into the study spec and make it the current study. Detects the format: Qualtrics .qsf, REDCap data dictionary .csv, Wear-IT getData JSON, the older spec format, or a spec JSON.',
      inputSchema: { path: z.string().describe('Path to the file (relative to the working folder or absolute).') },
    },
    guard(({ path }) => {
      const file = resolve(ctx.dir, path);
      const input = { fileName: basename(file), text: readFileSync(file, 'utf8') };
      const t = detectTranslator(input);
      if (!t) return fail(`Could not tell what kind of file ${input.fileName} is.`);
      const tr = t.translate(input);
      const r = validateSpec(tr.spec);
      if (!r.spec) return fail(`Read as ${t.label}, but it does not form a valid study:\n${issuesText(r)}`);
      writeStudy(r.spec);
      return text(`Imported as ${t.label}. ${summary(r.spec)}${tr.notes.length ? `\nNotes:\n- ${tr.notes.join('\n- ')}` : ''}`);
    }),
  );

  server.registerTool(
    'export_study',
    {
      title: 'Export to another platform',
      description: `Write the current study in another platform's import format: ${EXPORT_FORMATS.map((f) => `${f.id} (${f.label})`).join('; ')}. Returns the file path and anything that could not be carried over.`,
      inputSchema: { format: z.enum(EXPORT_FORMATS.map((f) => f.id) as [ExportFormat, ...ExportFormat[]]).describe('Target format.') },
    },
    guard(({ format }) => {
      const res = exportStudy(needStudy(), format);
      writeFileSync(out(res.fileName), res.text, 'utf8');
      return text(`Wrote ${out(res.fileName)}.${res.notes.length ? `\nNotes:\n- ${res.notes.join('\n- ')}` : ''}`);
    }),
  );

  if (!ctx.isPublic) {
    server.registerTool(
      'pull_data',
      {
        title: 'Pull a study from a data platform',
        description:
          'Pull a study (and optionally its responses) from Wear-IT, REDCap or Qualtrics and make it the current study. Keys never pass through the AI: use a key saved in the Data Manual app (name it with `key`; see list_saved_keys; when only one saved key fits, it is used automatically), or an environment variable (DATA_MANUAL_WEARIT_TOKEN, DATA_MANUAL_REDCAP_TOKEN, DATA_MANUAL_QUALTRICS_TOKEN, or name one with token_env). For Qualtrics without survey_id, lists the surveys the key can see.',
        inputSchema: {
          source: z.enum(['wearit', 'redcap', 'qualtrics']),
          study_id: z.string().optional().describe('Wear-IT study ID.'),
          server: z.enum(WEARIT_SERVERS.map((s) => s.id) as ['wearables-survey', 'wearables-survey_sdb']).optional().describe('Wear-IT server (default wearables-survey).'),
          url: z.string().optional().describe('REDCap API URL, e.g. https://redcap.example.edu/api/.'),
          datacenter: z.string().optional().describe('Qualtrics datacenter ID, e.g. iad1 or ca1.'),
          survey_id: z.string().optional().describe('Qualtrics survey ID (SV_...).'),
          include_responses: z.boolean().optional().describe('Also pull response data (REDCap / Qualtrics; default true).'),
          key: z.string().optional().describe('Name of a saved key (from list_saved_keys).'),
          token_env: z.string().optional().describe('Name of an environment variable holding the token.'),
        },
      },
      guard(async (a) => {
        const envName = a.token_env ?? `DATA_MANUAL_${a.source.toUpperCase()}_TOKEN`;
        let token = a.token_env ? process.env[envName] : undefined;
        if (!token && a.key) {
          const k = findKey(a.key);
          if (!k || k.kind !== a.source) return fail(`No saved ${a.source} key named "${a.key}". Saved keys: ${listKeys().filter((x) => x.kind === a.source).map((x) => x.label).join(', ') || 'none'}.`);
          token = `vault:${k.id}`;
        }
        if (!token) {
          const fits = listKeys().filter((k) => k.kind === a.source && (!a.url || !k.meta.url || new URL(k.meta.url).host === new URL(a.url.startsWith('http') ? a.url : `https://${a.url}`).host) && (!a.datacenter || !k.meta.datacenter || k.meta.datacenter === a.datacenter));
          if (fits.length === 1) token = `vault:${fits[0]!.id}`;
          else if (fits.length > 1) return fail(`Several saved ${a.source} keys fit: ${fits.map((k) => k.label).join(', ')}. Name one with \`key\`.`);
        }
        token ??= process.env[envName];
        if (!token) return fail(`No ${a.source} key found. Save one in the Data Manual app (Data Import, or Settings → Saved API keys), or set the ${envName} environment variable, then try again.`);
        const withData = a.include_responses ?? true;
        let r: ValidationResult;
        let notes: string[] = [];
        if (a.source === 'wearit') {
          if (!a.study_id) return fail('study_id is required for Wear-IT.');
          const pages = await pullWearit({ server: a.server ?? 'wearables-survey', studyId: a.study_id, token });
          const conv = wearitPagesToSpec(pages, { studyId: a.study_id });
          r = validateSpec(conv.spec);
          notes = conv.notes;
        } else if (a.source === 'redcap') {
          if (!a.url) return fail('url is required for REDCap.');
          const res = await pullRedcap({ url: a.url, token, includeRecords: withData, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
          r = res.result;
          notes = res.notes;
        } else {
          if (!a.datacenter) return fail('datacenter is required for Qualtrics.');
          if (!a.survey_id) {
            const list = await listQualtricsSurveys(a.datacenter, token);
            return text(list.length ? list.map((s) => `${s.id}  ${s.name}${s.isActive ? '' : ' (inactive)'}`).join('\n') : 'No surveys found for this token.');
          }
          const res = await pullQualtrics({ datacenter: a.datacenter, surveyId: a.survey_id, token, includeResponses: withData });
          r = res.result;
          notes = res.notes;
        }
        if (!r.spec) return fail(`Pulled, but it did not form a valid study:\n${issuesText(r)}`);
        writeStudy(r.spec);
        return text(`Pulled from ${a.source}. ${summary(r.spec)}${notes.length ? `\nNotes:\n- ${notes.join('\n- ')}` : ''}`);
      }),
    );
  }

  if (!ctx.isPublic) {
    server.registerTool(
      'list_saved_keys',
      {
        title: 'List saved API keys',
        description: 'Names of the API keys saved on this computer (by the Data Manual app), with their platform and server. Never returns the keys themselves.',
      },
      guard(() => {
        const keys = listKeys();
        return text(keys.length ? keys.map((k) => `${k.label}  [${k.kind}]${k.meta.url ? ` ${k.meta.url}` : ''}${k.meta.datacenter ? ` ${k.meta.datacenter}` : ''}  ${k.hint}`).join('\n') : 'No saved keys. Add one in the Data Manual app.');
      }),
    );
  }

  // ---------- Outputs ----------
  server.registerTool(
    'generate_codebook',
    {
      title: 'Generate the codebook',
      description: `Write Codebook.html for the current study (works before data is collected). Defaults match the app: everything except the Title Page is included. Use include/exclude with these names: ${SECTION_NAMES.join(', ')}. Excluding a section excludes everything under it; excluding a question type removes those variables.`,
      inputSchema: {
        title: z.string().optional(),
        authors: z.string().optional(),
        funding: z.string().optional(),
        abstract: z.string().optional(),
        summary: z.string().optional().describe('Executive summary text.'),
        include: z.array(z.enum(SECTION_NAMES)).optional().describe('Sections to switch on (e.g. "Title Page").'),
        exclude: z.array(z.enum(SECTION_NAMES)).optional().describe('Sections to leave out.'),
        theme: z.enum(Object.keys(CODEBOOK_PRESETS) as [string, ...string[]]).optional().describe('Color theme preset.'),
      },
    },
    guard((a) => {
      const spec = needStudy();
      const theme = a.theme ? CODEBOOK_PRESETS[a.theme]?.theme : undefined;
      const html = generateCodebookHtml(spec, codebookOptions(a.include, a.exclude), { theme, flowchartsInBrowser: true }, {
        title: a.title,
        authors: a.authors,
        funding: a.funding,
        abstract: a.abstract,
        summary: a.summary,
      });
      writeFileSync(out('Codebook.html'), html, 'utf8');
      const ex = [...(a.exclude ?? [])];
      return text(`Codebook written to ${out('Codebook.html')}.${ex.length ? ` Excluded: ${ex.join(', ')}.` : ''}${a.include?.length ? ` Included: ${a.include.join(', ')}.` : ''} Save as PDF from a browser's print dialog.`);
    }),
  );

  server.registerTool(
    'generate_data_dictionary',
    {
      title: 'Generate the data dictionary',
      description: 'Write DataDictionary.csv for the current study and return its first 50 rows (variable metadata only, no responses).',
    },
    guard(() => {
      const rows = generateDataDictionary(needStudy());
      writeFileSync(out('DataDictionary.csv'), dataDictionaryCsv(rows), 'utf8');
      const strip = rows.slice(0, 50).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
      return text(`Wrote ${out('DataDictionary.csv')} (${rows.length} rows).\n${JSON.stringify(strip, null, 2)}`);
    }),
  );

  server.registerTool(
    'survey_flowchart',
    {
      title: 'Survey flowchart',
      description: 'With no survey: list the surveys. With a survey name: return its skip-logic flowchart as Mermaid code (format "mermaid") or an indented text outline (format "outline", the default).',
      inputSchema: {
        survey: z.string().optional().describe('Survey.Name (or long name).'),
        format: z.enum(['outline', 'mermaid']).optional(),
      },
    },
    guard(({ survey, format }) => {
      const spec = needStudy();
      if (!survey) return text(spec.surveys.map((s) => `${s['Survey.Name']}${s['Survey.LongName'] ? ` (${s['Survey.LongName']})` : ''}`).join('\n'));
      const s = spec.surveys.find((x) => x['Survey.Name'] === survey || x['Survey.LongName'] === survey);
      if (!s) return fail(`No survey named "${survey}". Surveys: ${spec.surveys.map((x) => x['Survey.Name']).join(', ')}`);
      if (!flowKnown(s)) return text(`"${s['Survey.Name']}" has no flowchart: the order its questions are asked in and its skip logic aren't known (it was built from a dataset's columns). Its variables are still listed in the data dictionary and codebook.`);
      return text(format === 'mermaid' ? generateFlowchart(s) : flowchartText(s));
    }),
  );

  server.registerTool(
    'study_schedule',
    {
      title: 'Study schedule',
      description: 'Summarize when each survey is delivered: events, recurrence, times and the study length.',
    },
    guard(() => {
      const sch = buildStudySchedule(needStudy());
      if (!sch.events.length) return text('This study has no schedule.');
      return text(JSON.stringify(sch.events.map((e) => ({ title: e.title, survey: e.surveyName, timing: e.timingType, window: e.windowText, recurrence: e.recurrenceText, firstDate: e.occurrences[0]?.date ?? null, occurrences: e.occurrences.length })), null, 2));
    }),
  );

  server.registerTool(
    'describe_variable',
    {
      title: 'Describe a variable',
      description: 'Aggregate statistics for one question from the response data: deliveries, response rate, participants, and frequencies or mean/SD/range. Never returns individual responses.',
      inputSchema: { item_id: z.string().describe('Item.ID or Question.ID.') },
    },
    guard(({ item_id }) => {
      const spec = needStudy();
      if (!hasResponseData(spec)) return text('This study has no response data.');
      const q = surveyModels(spec)
        .flatMap((m) => m.survey.questions ?? [])
        .find((x) => x['Item.ID'] === item_id || x['Question.ID'] === item_id);
      if (!q) return fail(`No question with ID ${item_id}.`);
      const ov = dataOverview(spec);
      const d = describeItem(q, indexResponses(spec).get(q['Question.ID']), ov?.participants ?? 0);
      if (!d) return text(`${item_id} has no responses.`);
      return text(
        JSON.stringify(
          {
            question: q['Question.Text'],
            type: q['Question.Type.Display.Name'],
            delivered: d.delivered,
            answered: d.answered,
            responseRate: d.delivered ? Number((d.answered / d.delivered).toFixed(3)) : null,
            participants: d.participants,
            frequencies: d.frequencies?.map((f) => ({ value: f.value, label: f.label, count: f.count, percent: Number(f.percent.toFixed(1)) })),
            numeric: d.numeric ? { mean: d.numeric.mean, sd: d.numeric.sd, min: d.numeric.min, median: d.numeric.median, max: d.numeric.max } : undefined,
          },
          null,
          2,
        ),
      );
    }),
  );
}

export { buildBlockMap };
