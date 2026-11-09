import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import schema from '../../../schema/study.schema.json';
import type { StudySpec } from './spec';
import type { SpecIssue } from './issues';
import { checkCrossReferences } from './crossRefs';

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

/** Validate unknown input (e.g. parsed JSON) against the schema, then check cross-references. */
export function validateSpec(input: unknown): ValidationResult {
  if (!validateSchema(input)) {
    const issues: SpecIssue[] = (validateSchema.errors ?? []).map((e) => ({
      severity: 'error',
      source: 'schema',
      path: e.instancePath || '/',
      message: e.message ?? 'Invalid value',
    }));
    return { valid: false, issues, spec: null };
  }
  const issues = checkCrossReferences(input);
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
