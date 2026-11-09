import type { PageId } from '../App';
import { Box } from '../ui';

/** Shown on output pages before a study is loaded. */
export function NoStudy({ go, what = 'this' }: { go(id: PageId): void; what?: string }) {
  return (
    <Box title="No study loaded">
      <p>Pull data or import a study file first, then come back to generate {what}.</p>
      <button className="dm-btn dm-btn-primary" onClick={() => go('datapull')}>
        Go to Data Pull
      </button>
    </Box>
  );
}
