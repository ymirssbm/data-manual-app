// Data Export: the loaded study in other platforms' formats, and its responses as CSV.
import { useMemo, useState } from 'react';
import type { StudySpec } from '../../core';
import { hasResponseData } from '../../generators';
import { EXPORT_FORMATS, exportStudy, type ExportFormat, type ExportResult } from '../../exporters';
import type { PageId } from '../App';
import { Box, Field, Icon, PageTitle, Row } from '../ui';
import { download } from '../util';
import { NoStudy } from './common';

export function DataExportPage({ spec, go, notify }: { spec: StudySpec | null; go(id: PageId): void; notify(text: string, kind?: 'message' | 'error' | 'warning'): void }) {
  const [format, setFormat] = useState<ExportFormat>('redcap');
  const [survey, setSurvey] = useState('');
  const [last, setLast] = useState<ExportResult | null>(null);
  const hasData = spec ? hasResponseData(spec) : false;
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const preview = useMemo(() => {
    if (!spec) return null;
    try {
      return exportStudy(spec, format, { survey: survey || undefined });
    } catch {
      return null;
    }
  }, [spec, format, survey]);

  if (!spec) return <NoStudy go={go} what="an export" />;

  const run = () => {
    try {
      const out = exportStudy(spec, format, { survey: survey || undefined });
      download(out.fileName, out.text, out.mime);
      setLast(out);
      notify(`Downloaded ${out.fileName}.`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <>
      <PageTitle>Data Export</PageTitle>
      <Row>
        <Box title="Export the loaded study">
          <p className="dm-muted">Exports are made from the study as it is loaded now, including edits applied in the Survey Editor.</p>
          {(['Study design', 'Response data'] as const).map((group) => (
            <div key={group} className="dm-export-group">
              <h4 className="dm-subhead">{group}</h4>
              <div className="dm-export-grid">
                {EXPORT_FORMATS.filter((f) => f.group === group).map((f) => {
                  const disabled = !!f.needsData && !hasData;
                  return (
                    <label key={f.id} className={`dm-export-card${format === f.id ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}>
                      <input type="radio" name="export-format" checked={format === f.id} disabled={disabled} onChange={() => (setFormat(f.id), setLast(null))} />
                      <strong>{f.label}</strong>
                      <span>{disabled ? 'This study has no response data.' : f.help}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="dm-export-foot">
            {meta.perSurvey && (
              <Field label="Survey">
                <select className="dm-input dm-select-sm" value={survey} onChange={(e) => setSurvey(e.target.value)}>
                  <option value="">All surveys in one file</option>
                  {spec.surveys.map((s) => (
                    <option key={s['Survey.Name']} value={s['Survey.Name']}>
                      {s['Survey.LongName'] || s['Survey.Name']}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <button className="dm-btn dm-btn-primary dm-btn-lg" onClick={run} disabled={!preview}>
              <Icon name="download" size={18} /> Download {preview?.fileName ?? ''}
            </button>
          </div>
          {(last ?? preview)?.notes.length ? (
            <ul className="dm-notes">
              {(last ?? preview)!.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {preview && (
            <details className="dm-export-preview">
              <summary>Preview the file</summary>
              <pre className="dm-code">{preview.text.slice(0, 4000)}{preview.text.length > 4000 ? '\n…' : ''}</pre>
            </details>
          )}
        </Box>
      </Row>
    </>
  );
}
