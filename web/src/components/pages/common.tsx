import type { PageId } from '../App';
import { Box } from '../ui';

/** The two halves of Data Import: platforms and study files, or your own response dataset. */
export function ImportTabs({ page, go }: { page: 'datapull' | 'dataset'; go(id: PageId): void }) {
  return (
    <div className="dm-segmented dm-segmented-inline dm-import-tabs" role="tablist">
      <button role="tab" aria-selected={page === 'datapull'} className={page === 'datapull' ? 'is-active' : ''} onClick={() => go('datapull')}>
        Platforms and study files
      </button>
      <button role="tab" aria-selected={page === 'dataset'} className={page === 'dataset' ? 'is-active' : ''} onClick={() => go('dataset')}>
        Your dataset (CSV)
      </button>
    </div>
  );
}

/** Shown on output pages before a study is loaded. */
export function NoStudy({ go, what = 'this' }: { go(id: PageId): void; what?: string }) {
  return (
    <Box title="No study loaded">
      <p>Pull data or import a study file first, then come back to generate {what}.</p>
      <button className="dm-btn dm-btn-primary" onClick={() => go('datapull')}>
        Go to Data Import
      </button>
    </Box>
  );
}
