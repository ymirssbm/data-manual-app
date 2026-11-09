export type IssueSeverity = 'error' | 'warning';

/** A problem found in a study spec. `path` is a JSON pointer into the spec. */
export interface SpecIssue {
  severity: IssueSeverity;
  source: 'schema' | 'reference';
  path: string;
  message: string;
}
