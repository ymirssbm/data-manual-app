// AI study generation/modification: prompt building, response parsing, validation
// with automatic repair, and AI provenance. Provider calls live in providers.ts.
import schema from '../../../schema/study.schema.json';
import { buildBlockMap, validateSpec, type StudySpec, type Survey, type ValidationResult } from '../core';
import { callModel, type AiConfig, type ChatTurn } from './providers';

const SCHEMA_TEXT = JSON.stringify(schema);

export const SYSTEM_PROMPT = `You design and edit study specifications for a research data documentation tool. Researchers describe studies (surveys, questions, skip logic, schedules); you produce a study spec in JSON that conforms to the JSON Schema below. The app turns the spec into codebooks, data dictionaries, survey flowcharts and study schedules, so accuracy of structure and skip logic matters more than prose.

How a spec fits together:
- surveys[].questions is an ordered list of items. Blocks are items with "Item.Type": "Block" and "Question.Type.Display.Name": "Block"; questions inside a block set "Parent" to the block's Item.ID. Top-level items use "Parent": null.
- Question items (Item.Type "Question") must have Question.Text, Data.Type and responseKey (use [] when there are no fixed options). Block items must not have those three keys.
- Item.ID is unique within a survey. Question.ID is the variable name as it appears in the data; keep it short and snake_case.
- Skip logic: the controlling question lists its children in Conditional.Info.Conditional.Child.Mappings as {"Conditional.Child.Item.ID", "Definition"}, where Definition is the response label that opens that child (repeat the child for each label that opens it). Each child (a question or a whole block) records Conditional.Info.Conditional.Master.Item.ID (the controlling item), Conditional.Type (1 "=", 2 "<=", 3 ">=", 4 "<", 5 ">", 6 "!=") and Conditional.Threshold (the response value, e.g. "1"). Use Conditional.Fail.Item.ID on the controlling question for where to go when no branch applies, and Multi.Conditional / Conditional.Limit for mutually exclusive branches. Children come after their controlling question in the list.
- schedules[].events need id (UUID), title, start and end (ISO 8601 with offset, e.g. 2026-02-02T08:00:00-05:00); repeat with recurrence {frequency, interval, count | until, byDay}. Link an event to a survey with extensions["Survey.Name"], which must equal a survey's Survey.Name.
- You may omit blockMap (the app rebuilds it from Parent) and never include a "data" block or "AI.Information" (the app manages both).
- Prefer validated instruments and standard response scales when the researcher names a construct; put the instrument or citation in Question.Description.

How to reply:
- When you create or change a study, write two or three sentences on what you did, then the COMPLETE updated spec in a single \`\`\`json code block. Always return the whole spec, never a fragment or a diff.
- When the researcher only asks a question, answer it briefly and include no JSON.
- If a request is ambiguous, make a reasonable choice, say what you assumed, and still return the spec.

JSON Schema for the study spec:
${SCHEMA_TEXT}`;

/** The spec as the model should see it: no response data (large and irrelevant to design), no derived blockMap. */
export function specForPrompt(spec: StudySpec): string {
  const { data: _data, blockMap: _blockMap, 'AI.Information': _ai, ...rest } = spec as StudySpec & Record<string, unknown>;
  void _data;
  void _blockMap;
  void _ai;
  return JSON.stringify(rest, null, 1);
}

/** Pull the spec JSON out of a reply: the last ```json block, else the outermost {...}. */
export function extractSpecJson(reply: string): unknown | null {
  const blocks = [...reply.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]!);
  const candidates = blocks.length ? blocks.reverse() : [];
  const first = reply.indexOf('{');
  const last = reply.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(reply.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Text shown in the chat: the reply without its (large) JSON block. */
export function replyProse(reply: string): string {
  return reply.replace(/```(?:json)?\s*\n[\s\S]*?```/gi, '').trim() || 'Updated the study spec.';
}

export interface AiResult {
  /** Prose part of the final reply. */
  message: string;
  /** Validated spec, when the reply contained one. */
  result: ValidationResult | null;
  /** Repair rounds used. */
  repairs: number;
}

export interface RunOptions {
  config: AiConfig;
  /** Earlier conversation (prose only; JSON blocks already stripped). */
  history: ChatTurn[];
  prompt: string;
  /** Spec to modify; null to generate from scratch. */
  base: StudySpec | null;
  onText?(soFar: string): void;
  onStatus?(status: string): void;
  signal?: AbortSignal;
  maxRepairs?: number;
}

export async function runStudyAi({ config, history, prompt, base, onText, onStatus, signal, maxRepairs = 2 }: RunOptions): Promise<AiResult> {
  const userTurn = base
    ? `Current study spec:\n\`\`\`json\n${specForPrompt(base)}\n\`\`\`\n\nRequest: ${prompt}`
    : `There is no study yet; create a new one.\n\nRequest: ${prompt}`;
  const turns: ChatTurn[] = [...history, { role: 'user', content: userTurn }];

  onStatus?.('Thinking…');
  let reply = await callModel(config, SYSTEM_PROMPT, turns, { onText, signal });
  let repairs = 0;
  for (;;) {
    const json = extractSpecJson(reply);
    if (!json) return { message: reply.trim(), result: null, repairs };
    const result = validateSpec(finalize(json, base, prompt, config));
    const errors = result.issues.filter((i) => i.severity === 'error');
    if (!errors.length || repairs >= maxRepairs) return { message: replyProse(reply), result, repairs };
    repairs++;
    onStatus?.(`Fixing ${errors.length} validation error${errors.length === 1 ? '' : 's'} (pass ${repairs} of ${maxRepairs})…`);
    turns.push({ role: 'assistant', content: reply });
    turns.push({
      role: 'user',
      content: `That spec failed validation:\n${errors
        .slice(0, 40)
        .map((e) => `- ${e.path}: ${e.message}`)
        .join('\n')}\n\nFix these and return the complete corrected spec in one json code block.`,
    });
    reply = await callModel(config, SYSTEM_PROMPT, turns, { onText, signal });
  }
}

/** Attach what the app manages: rebuilt blockMap, the base study's response data, and AI provenance. */
function finalize(raw: unknown, base: StudySpec | null, prompt: string, config: AiConfig): unknown {
  return applyAiProvenance(raw, base, prompt, config.model);
}

/**
 * Shared by the in-app assistant and the MCP save_study tool: rebuilds the block map, keeps the base
 * study's response data (models never supply data), and records AI disclosure and prompts.
 */
export function applyAiProvenance(raw: unknown, base: StudySpec | null, prompt: string, model: string): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const spec = { ...(raw as Record<string, unknown>) };
  delete spec['AI.Information'];
  if (Array.isArray(spec.surveys)) spec.blockMap = buildBlockMap(spec.surveys as Survey[]);
  // Response data never comes from the model; keep the base study's data as-is.
  delete spec.data;
  if (base?.data) spec.data = base.data;

  const prev = base?.['AI.Information'];
  const disclosure = [...(prev?.['AI.Disclosure'] ?? [])];
  if (!disclosure.some((d) => d.Model === model)) disclosure.push({ Characteristic: base ? 'Modification' : 'All', Model: model });
  spec['AI.Information'] = {
    'AI.Disclosure': disclosure,
    'AI.Generation.Prompt': base ? (prev?.['AI.Generation.Prompt'] ?? null) : prompt,
    'AI.Modification.Prompts': base ? [...(prev?.['AI.Modification.Prompts'] ?? []), prompt] : [],
  };
  return spec;
}
