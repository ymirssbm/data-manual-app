import { isQuestion, surveyModels } from '../../core';
import type { PageId, Session } from '../App';
import { IssueList } from '../IssueList';
import { Box, Icon, Row } from '../ui';
import { download, safeFileName } from '../util';

const FEATURES: Array<{ icon: string; title: string; text: string; page: PageId }> = [
  { icon: 'download', title: 'Data Pull', text: 'Pull a study from Wear-IT, or import Qualtrics, REDCap and study spec files.', page: 'datapull' },
  { icon: 'book', title: 'Codebook', text: 'Generate a full HTML codebook with descriptives, and save it as a PDF.', page: 'codebook_gen' },
  { icon: 'table', title: 'Data Dictionary', text: 'One row per variable with types, ranges, response options and skip logic.', page: 'datadict_gen' },
  { icon: 'diagram', title: 'Study Flowchart', text: 'See how each survey flows, including blocks and skip logic.', page: 'flowchart' },
  { icon: 'calendar', title: 'Study Schedule', text: 'See when every survey is delivered across the study.', page: 'schedule' },
];

export function HomePage({ session, go }: { session: Session | null; go(id: PageId): void }) {
  const spec = session?.result.spec ?? null;
  const models = spec ? surveyModels(spec) : [];
  const nQuestions = models.reduce((a, m) => a + m.items.filter(isQuestion).length, 0);

  return (
    <>
      <Row>
        <Box title="Purpose of this tool">
          <p>
            This is a human accessible tool to pull study data and generate codebooks, data dictionaries, study flowcharts and schedules. Every
            source is converted into one structured study spec, so the same outputs work for any data collection platform. Nothing to install:
            it runs in your browser, and your files never leave your computer.
          </p>
        </Box>
        <Box title="Current Study">
          {spec && session ? (
            <>
              <p className="dm-lead">{spec['Study.Metadata']['Study.Name']}</p>
              <p>
                {models.length} survey{models.length === 1 ? '' : 's'} · {nQuestions} variables · {spec.schedules.length} schedule
                {spec.schedules.length === 1 ? '' : 's'} · {(spec.data?.['Question.ID']?.length ?? 0).toLocaleString()} responses
              </p>
              <p className="dm-muted">
                From {session.source.fileName} ({session.source.translatorLabel})
              </p>
              <button
                className="dm-btn dm-btn-secondary"
                onClick={() => download(`${safeFileName(spec['Study.Metadata']['Study.Name'])}.study.json`, JSON.stringify(spec, null, 2), 'application/json')}
              >
                <Icon name="download" /> Download study spec (JSON)
              </button>
            </>
          ) : (
            <>
              <p>No study loaded yet.</p>
              <button className="dm-btn dm-btn-primary" onClick={() => go('datapull')}>
                <Icon name="download" /> Go to Data Pull
              </button>
            </>
          )}
        </Box>
      </Row>
      {session && session.result.issues.length > 0 && <IssueList result={session.result} />}
      <div className="dm-feature-grid">
        {FEATURES.map((f) => (
          <button key={f.page} className="dm-feature-card" onClick={() => go(f.page)}>
            <span className="dm-feature-icon">
              <Icon name={f.icon} size={26} />
            </span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </button>
        ))}
      </div>
    </>
  );
}
