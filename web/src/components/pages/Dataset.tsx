import type { StudySpec, ValidationResult } from '../../core';
import type { LoadedSource } from './DataPull';
import { readExample } from './DataPull';
import { Box, PageTitle } from '../ui';
import { DatasetImport } from './DatasetImport';
import { ImportTabs } from './common';
import type { PageId } from '../App';

interface Props {
  spec: StudySpec | null;
  go(id: PageId): void;
  file: { name: string; text: string } | null;
  setFile(f: { name: string; text: string } | null): void;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

/** "Bring your own dataset": any CSV/TSV of responses, described by the user, used by every tool. */
export function DatasetPage({ spec, go, file, setFile, onLoaded, notify }: Props) {
  return (
    <>
      <PageTitle>Data Import</PageTitle>
      <ImportTabs page="dataset" go={go} />
      <Box title="Use Your Own Dataset">
        <p>
          Have responses from somewhere else (an EMA app export, a spreadsheet, an SPSS/R export saved as CSV)? Upload the file, say how it's laid out, and the
          codebook, data dictionary, descriptives and outlier screens all work on it.{' '}
          {spec ? (
            <>
              The data can be attached to <strong>{spec['Study.Metadata']['Study.Name']}</strong> (matched by variable name), or used to build a new study.
            </>
          ) : (
            <>No study is loaded, so a study will be built from the data. To get question text and labels, load a study spec or survey first, then attach this data to it.</>
          )}
        </p>
        <div className="dm-layouts">
          <div>
            <strong>Long</strong> <span className="dm-hint">one row per response (typical EMA export)</span>
            <table className="dm-mini">
              <tbody>
                <tr><th>pid</th><th>time</th><th>item</th><th>value</th></tr>
                <tr><td>S1</td><td>2/2 9:41</td><td>happy</td><td>5</td></tr>
                <tr><td>S1</td><td>2/2 9:41</td><td>stress</td><td>41</td></tr>
              </tbody>
            </table>
          </div>
          <div>
            <strong>Wide</strong> <span className="dm-hint">one row per session, a column per variable</span>
            <table className="dm-mini">
              <tbody>
                <tr><th>pid</th><th>time</th><th>happy</th><th>stress</th></tr>
                <tr><td>S1</td><td>2/2 9:41</td><td>5</td><td>41</td></tr>
                <tr><td>S1</td><td>2/2 20:09</td><td>4</td><td>63</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </Box>
      <Box title="Upload and Map Columns">
        <DatasetImport initial={file} spec={spec} onLoaded={onLoaded} notify={notify} />
        {!file && (
          <p className="dm-hint dm-mt">
            No file handy?{' '}
            <button className="dm-link-btn" onClick={() => void readExample('branching-ema-data.csv').then((text) => setFile({ name: 'branching-ema-data.csv', text }))}>
              Try the example study's responses (long CSV)
            </button>
          </p>
        )}
      </Box>
    </>
  );
}
