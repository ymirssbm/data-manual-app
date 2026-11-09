import { useMemo, useState } from 'react';
import type { StudySpec } from '../../core';
import { DICTIONARY_COLUMNS, dataDictionaryCsv, generateDataDictionary } from '../../generators';
import type { PageId } from '../App';
import { Box, Icon, PageTitle } from '../ui';
import { download, safeFileName } from '../util';
import { NoStudy } from './common';

const csvName = (spec: StudySpec) => `${safeFileName(spec['Study.Metadata']['Study.Name'])}_DataDictionary.csv`;

export function DictionaryGeneratorPage({ spec, go, onGenerated }: { spec: StudySpec | null; go(id: PageId): void; onGenerated(): void }) {
  return (
    <>
      <PageTitle>Data Dictionary Generator</PageTitle>
      {spec ? (
        <Box title="Generate Data Dictionary">
          <p>Press the button to generate a data dictionary from the study you loaded.</p>
          <div className="dm-inline">
            <button className="dm-btn dm-btn-primary dm-btn-lg" onClick={onGenerated}>
              <Icon name="table" size={18} /> Generate Data Dictionary
            </button>
            <button className="dm-btn dm-btn-secondary" onClick={() => download(csvName(spec), dataDictionaryCsv(generateDataDictionary(spec)), 'text/csv')}>
              <Icon name="download" /> Download CSV
            </button>
          </div>
        </Box>
      ) : (
        <NoStudy go={go} what="a data dictionary" />
      )}
    </>
  );
}

/** The prior tool's table (same columns, same order, blocks as rows), formatted for reading. */
export function DictionaryViewerPage({ spec, go }: { spec: StudySpec | null; go(id: PageId): void }) {
  const rows = useMemo(() => (spec ? generateDataDictionary(spec) : []), [spec]);
  const [query, setQuery] = useState('');
  if (!spec) return (<><PageTitle>Data Dictionary Viewer</PageTitle><NoStudy go={go} what="a data dictionary" /></>);

  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => DICTIONARY_COLUMNS.some((c) => r[c].toLowerCase().includes(q))) : rows;

  return (
    <>
      <PageTitle
        actions={
          <button className="dm-btn dm-btn-primary" onClick={() => download(csvName(spec), dataDictionaryCsv(rows), 'text/csv')}>
            <Icon name="download" /> Download CSV
          </button>
        }
      >
        Data Dictionary Viewer
      </PageTitle>
      <Box>
        <div className="dm-table-toolbar">
          <input className="dm-input dm-search" type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="dm-hint">{q ? `${visible.length} of ${rows.length} rows` : `${rows.length} rows`}</span>
        </div>
        <div className="dm-dd-wrap">
          <table className="dm-dd">
            <thead>
              <tr>
                {DICTIONARY_COLUMNS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={`${r._surveyName}/${r._itemId}`} className={r._isBlock ? 'is-block' : ''}>
                  {DICTIONARY_COLUMNS.map((c) => (
                    <td key={c} className={`dd-${c.replace(/\./g, '-')}`}>
                      {r[c] === '' ? <span className="dm-na">NA</span> : r[c]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="dm-empty">No rows match.</p>}
        </div>
      </Box>
    </>
  );
}
