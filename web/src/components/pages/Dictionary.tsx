import { useMemo, useState } from 'react';
import type { StudySpec } from '../../core';
import { DICTIONARY_COLUMNS, dataDictionaryCsv, generateDataDictionary } from '../../generators';
import type { PageId } from '../App';
import { Box, Icon, PageTitle } from '../ui';
import { download, safeFileName } from '../util';
import { NoStudy } from './common';

const csvName = (spec: StudySpec) => `${safeFileName(spec['Study.Metadata']['Study.Name'])}_DataDictionary.csv`;

/**
 * The data dictionary: built from the loaded study as you look at it (the prior tool's columns and
 * order, blocks as rows), searchable, and downloadable as CSV.
 */
export function DictionaryPage({ spec, go }: { spec: StudySpec | null; go(id: PageId): void }) {
  const rows = useMemo(() => (spec ? generateDataDictionary(spec) : []), [spec]);
  const [query, setQuery] = useState('');
  if (!spec) return (<><PageTitle>Data Dictionary</PageTitle><NoStudy go={go} what="a data dictionary" /></>);

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
        Data Dictionary
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
