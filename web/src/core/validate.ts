import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../../../schema/study.schema.json';
import type { StudySpec } from './spec';
import type { SpecIssue } from './issues';
import { checkCrossReferences } from './crossRefs';
import { isRfc3339, toIsoDateTime } from './time';

// strict: false because the schema carries non-standard annotation keywords
// (e.g. top-level "version"); they're documentation, not validation rules.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile<StudySpec>(schema);

export const SPEC_VERSION: string = (schema as { version?: string }).version ?? 'unknown';

export interface ValidationResult {
  /** True when there are no errors (warnings are allowed). */
  valid: boolean;
  issues: SpecIssue[];
  /** The spec, typed, when it passed schema validation. */
  spec: StudySpec | null;
}

/**
 * Response timestamps that aren't proper date-times shouldn't stop a study loading: convert what
 * can be converted, leave the rest as they are, and say so. Only timing-based features (charts by
 * date, time between assessments) depend on them, and those skip values that aren't dates.
 */
function repairTimestamps(input: unknown): { input: unknown; issue: SpecIssue | null } {
  const data = (input as { data?: Record<string, unknown> } | null)?.data;
  const times = data?.['Survey.Date.Completed'];
  if (!Array.isArray(times) || times.every((t) => isRfc3339(t))) return { input, issue: null };
  let converted = 0;
  let unreadable = 0;
  let example = '';
  const fixed = times.map((t) => {
    if (isRfc3339(t)) return t;
    const iso = toIsoDateTime(t as string | number | null);
    if (iso && isRfc3339(iso)) {
      converted++;
      return iso;
    }
    unreadable++;
    example ||= String(t);
    return t;
  });
  const parts = [converted ? `${converted.toLocaleString()} converted to date-times` : '', unreadable ? `${unreadable.toLocaleString()} couldn’t be read (e.g. “${example.slice(0, 40)}”) and were left as they are` : ''].filter(Boolean);
  return {
    input: { ...(input as object), data: { ...data, 'Survey.Date.Completed': fixed } },
    issue: {
      severity: 'warning',
      source: 'schema',
      path: '/data/Survey.Date.Completed',
      message: `Some response timestamps weren’t in date-time form: ${parts.join('; ')}.${unreadable ? ' Features that use timing (charts by date, time between assessments) skip those responses.' : ''}`,
    },
  };
}

/** Validate unknown input (e.g. parsed JSON) against the schema, then check cross-references. */
export function validateSpec(raw: unknown): ValidationResult {
  const { input, issue: timeIssue } = repairTimestamps(raw);
  const withTimeIssue = (issues: SpecIssue[]) => (timeIssue ? [timeIssue, ...issues] : issues);
  if (!validateSchema(input)) {
    // Timestamps that still can't be read are reported above, not as errors.
    const errors = (validateSchema.errors ?? []).filter((e) => !(timeIssue && e.keyword === 'format' && e.instancePath.startsWith('/data/Survey.Date.Completed')));
    if (!errors.length) {
      const issues = withTimeIssue(checkCrossReferences(input as StudySpec));
      return { valid: !issues.some((i) => i.severity === 'error'), issues, spec: input as StudySpec };
    }
    const issues: SpecIssue[] = errors.map((e) => ({
      severity: 'error',
      source: 'schema',
      path: e.instancePath || '/',
      message: e.message ?? 'Invalid value',
    }));
    return { valid: false, issues: withTimeIssue(issues), spec: null };
  }
  const issues = withTimeIssue(checkCrossReferences(input));
  return { valid: !issues.some((i) => i.severity === 'error'), issues, spec: input };
}

/** Parse JSON text and validate it. JSON syntax errors come back as an issue, not a throw. */
export function parseSpec(text: string): ValidationResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      valid: false,
      spec: null,
      issues: [{ severity: 'error', source: 'schema', path: '/', message: `Not valid JSON: ${(e as Error).message}` }],
    };
  }
  return validateSpec(data);
}
