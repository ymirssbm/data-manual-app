import type { ValidationResult } from '../core';
import { Box } from './ui';

export function IssueList({ result }: { result: ValidationResult }) {
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  return (
    <Box title={result.valid ? 'Study Spec Check: Valid' : 'Study Spec Check: Problems Found'}>
      <p className={result.valid ? 'dm-ok' : 'dm-bad'}>
        {errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        {result.valid ? '. All outputs can be generated.' : '. Outputs need a valid spec.'}
      </p>
      {result.issues.length > 0 && (
        <ul className="dm-issues">
          {result.issues.slice(0, 200).map((issue, i) => (
            <li key={i} className={`dm-issue dm-issue-${issue.severity}`}>
              <code>{issue.path}</code> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
