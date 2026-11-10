import { Fragment, useMemo, useState } from 'react';
import { isQuestion, surveyModels, validateSpec, type ValidationResult } from '../../core';
import { enrollment } from '../../generators';
import { detectTranslator } from '../../translators';
import type { PageId, Session } from '../App';
import { IssueList } from '../IssueList';
import { Icon } from '../ui';
import { readExample, type LoadedSource } from './DataPull';

const DOCS = 'https://github.com/ymirssbm/data-manual-app/blob/main/docs/';

interface Stage {
  n: number;
  title: string;
  text: string;
  icon: string;
  items: Array<{ label: string; page: PageId | null }>;
}

/** The path a study takes through the app. Every chip opens the page that does that step. */
const STAGES: Stage[] = [
  {
    n: 1,
    title: 'Bring it in',
    icon: 'import',
    text: 'Pull a study from a platform, open a file, add your own data, or describe one to AI.',
    items: [
      { label: 'Wear-IT', page: 'datapull' },
      { label: 'REDCap', page: 'datapull' },
      { label: 'Qualtrics', page: 'datapull' },
      { label: 'Upload a file', page: 'datapull' },
      { label: 'Your dataset (CSV)', page: 'dataset' },
      { label: 'AI generation', page: 'ai' },
    ],
  },
  {
    n: 2,
    title: 'One study spec',
    icon: 'file',
    text: 'Every source becomes the same checked JSON format, kept in your browser.',
    items: [{ label: 'Validated on load', page: null }],
  },
  {
    n: 3,
    title: 'Describe it',
    icon: 'book',
    text: 'Generate the documents a study needs, straight from the spec.',
    items: [
      { label: 'Codebook', page: 'codebook_gen' },
      { label: 'Data dictionary', page: 'datadict_gen' },
      { label: 'Flowchart', page: 'flowchart' },
      { label: 'Schedule', page: 'schedule' },
    ],
  },
  {
    n: 4,
    title: 'Refine it',
    icon: 'edit',
    text: 'Change questions, blocks and skip logic by hand or with AI, then regenerate.',
    items: [
      { label: 'Survey Editor', page: 'editor' },
      { label: 'AI changes', page: 'ai' },
    ],
  },
  {
    n: 5,
    title: 'Send it out',
    icon: 'export',
    text: 'Export the design to another platform, or the responses for analysis.',
    items: [
      { label: 'REDCap', page: 'export' },
      { label: 'Qualtrics', page: 'export' },
      { label: 'SurveyJS', page: 'export' },
      { label: 'Responses CSV', page: 'export' },
    ],
  },
];

const PRINCIPLES = [
  { icon: 'lock', title: 'Your data stays on your computer', text: 'Everything runs in your browser. API keys live in your computer’s secure storage, never in the page.' },
  { icon: 'file', title: 'One format for every platform', text: 'Wear-IT, REDCap, Qualtrics and plain CSV all become the same study spec, so every tool works with all of them.' },
  { icon: 'spark', title: 'AI without sharing responses', text: 'AI tools see the study design only. Response data is never sent to a model, and AI use is recorded in the study.' },
];

const HELP = [
  { label: 'Getting started', href: `${DOCS}getting-started.md` },
  { label: 'Importing and exporting', href: `${DOCS}import-export.md` },
  { label: 'The study spec', href: `${DOCS}study-spec.md` },
  { label: 'Codebooks and other outputs', href: `${DOCS}outputs.md` },
  { label: 'AI tools and the MCP server', href: `${DOCS}ai-and-mcp.md` },
  { label: 'Privacy and API keys', href: `${DOCS}privacy.md` },
];

const fmtDate = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function HomePage({
  session,
  go,
  onLoaded,
  notify,
}: {
  session: Session | null;
  go(id: PageId): void;
  onLoaded(source: LoadedSource, result: ValidationResult): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): unknown;
}) {
  const spec = session?.result.spec ?? null;
  const [loading, setLoading] = useState(false);

  const loadExample = async () => {
    setLoading(true);
    try {
      const text = await readExample('branching-ema-study.json');
      const input = { fileName: 'branching-ema-study.json', text };
      const t = detectTranslator(input);
      if (!t) throw new Error('The example study could not be read.');
      const { spec: s, notes } = t.translate(input);
      onLoaded({ fileName: input.fileName, translatorLabel: t.label, notes }, validateSpec(s));
    } catch (e) {
      notify((e as Error).message, 'error', 8000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dm-home">
      {/* A: Introduction */}
      <section className="dm-home-hero">
        <div>
          <h1>Data Manual</h1>
          <p className="dm-home-tag">Document, check and move survey studies between platforms.</p>
          <p>
            Bring in a study from Wear-IT, REDCap, Qualtrics or your own spreadsheet, and Data Manual turns it into one structured study spec. From
            there you can make a codebook, data dictionary, flowchart and schedule, edit the surveys, and export the study to another platform. It
            all runs in your browser.
          </p>
        </div>
        <div className="dm-home-cta">
          <button className="dm-btn dm-btn-primary" onClick={() => go('datapull')}>
            <Icon name="import" /> Import a study
          </button>
          <button className="dm-btn dm-btn-secondary" onClick={() => void loadExample()} disabled={loading}>
            <Icon name="eye" /> {loading ? 'Loading…' : 'Try the example study'}
          </button>
          <button className="dm-btn dm-btn-secondary" onClick={() => go('ai')}>
            <Icon name="spark" /> Design one with AI
          </button>
        </div>
      </section>

      {/* B: Current study */}
      {spec && session ? <StudySummary session={session} go={go} /> : null}

      {/* C: How it works */}
      <section className="dm-home-section">
        <h2>How it works</h2>
        <div className="dm-flow">
          {STAGES.map((s, i) => (
            <Fragment key={s.n}>
              {i > 0 && (
                <span className="dm-flow-arrow" aria-hidden>
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path d="M4 12h15m-5-5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              <div className={`dm-flow-stage${s.n === 2 ? ' is-hub' : ''}${s.n === 3 || s.n === 4 ? ' is-loop' : ''}`}>
                <div className="dm-flow-head">
                  <span className="dm-flow-n">{s.n}</span>
                  <h3>{s.title}</h3>
                </div>
                <p>{s.text}</p>
                <div className="dm-flow-items">
                  {s.items.map((it) =>
                    it.page ? (
                      <button key={it.label} className="dm-chip" onClick={() => go(it.page!)}>
                        {it.label}
                      </button>
                    ) : (
                      <span key={it.label} className="dm-chip is-static">
                        {it.label}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        <p className="dm-flow-loop">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path d="M20 12a8 8 0 11-2.3-5.7M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Steps 3 and 4 repeat: every change in the editor or from AI updates the codebook, dictionary, flowchart and schedule.
        </p>
      </section>

      {/* D: Getting started (only before a study is loaded) */}
      {!spec && (
        <section className="dm-home-section">
          <h2>Getting started</h2>
          <ol className="dm-steps">
            <li>
              <strong>Load a study.</strong> Pull one with an API key, drop a .qsf or REDCap dictionary on Data Import, or try the example study.
            </li>
            <li>
              <strong>Check it.</strong> Problems found while reading the study are listed here on Home.
            </li>
            <li>
              <strong>Make what you need.</strong> Generate a codebook, export to another platform, or open the Survey Editor.
            </li>
          </ol>
        </section>
      )}

      {/* E: Principles */}
      <section className="dm-home-section">
        <h2>Built for research data</h2>
        <div className="dm-principles">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="dm-principle">
              <span className="dm-principle-icon">
                <Icon name={p.icon} size={20} />
              </span>
              <div>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* F: Help */}
      <section className="dm-home-section">
        <h2>Help and documentation</h2>
        <ul className="dm-help-links">
          {HELP.map((h) => (
            <li key={h.href}>
              <a href={h.href} target="_blank" rel="noreferrer">
                <Icon name="book" size={15} /> {h.label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StudySummary({ session, go }: { session: Session; go(id: PageId): void }) {
  const spec = session.result.spec!;
  const models = useMemo(() => surveyModels(spec), [spec]);
  const enrolled = useMemo(() => enrollment(spec), [spec]);
  const nQuestions = models.reduce((a, m) => a + m.items.filter(isQuestion).length, 0);
  const nResponses = spec.data?.['Question.ID']?.length ?? 0;
  const participants = new Set(spec.data?.['Participant.ID'] ?? []).size;
  const issues = session.result.issues;
  const nErr = issues.filter((i) => i.severity === 'error').length;
  const nWarn = issues.length - nErr;

  const tiles: Array<[string, string]> = [
    ['Surveys', String(models.length)],
    ['Questions', String(nQuestions)],
    ['Schedules', String(spec.schedules.length)],
    ['Participants', participants.toLocaleString()],
    ['Responses', nResponses.toLocaleString()],
  ];
  if (enrolled.length) {
    const a = enrolled[0]!.date;
    const b = enrolled[enrolled.length - 1]!.date;
    // Same year: "Jan 11 – Jun 9, 2026" keeps the tile to one or two lines.
    const start = a.slice(0, 4) === b.slice(0, 4) ? fmtDate(a).replace(/,? \d{4}$/, '') : fmtDate(a);
    tiles.push(['Enrollment', `${start} – ${fmtDate(b)}`]);
  }

  // One suggestion at a time, in the order a study usually needs them.
  const next: { text: string; label: string; page: PageId } = nErr
    ? { text: 'Fix the problems listed below before generating outputs.', label: 'Open Survey Editor', page: 'editor' }
    : !nResponses
      ? { text: 'There are no responses yet. Add a dataset to get descriptives in the codebook.', label: 'Add your dataset', page: 'dataset' }
      : { text: 'Everything is ready. A codebook is usually the next thing to make.', label: 'Generate codebook', page: 'codebook_gen' };

  return (
    <section className="dm-home-section dm-home-study">
      <div className="dm-home-study-head">
        <div>
          <span className="dm-eyebrow">Current study</span>
          <h2>{spec['Study.Metadata']['Study.Name']}</h2>
          <p className="dm-muted">
            From {session.source.fileName} ({session.source.translatorLabel}) ·{' '}
            {nErr ? (
              <span className="dm-status is-bad">
                {nErr} problem{nErr === 1 ? '' : 's'}
              </span>
            ) : nWarn ? (
              <span className="dm-status is-warn">
                Valid, {nWarn} warning{nWarn === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="dm-status is-ok">Valid</span>
            )}
          </p>
        </div>
        <div className="dm-next">
          <p>{next.text}</p>
          <button className="dm-btn dm-btn-primary" onClick={() => go(next.page)}>
            {next.label}
          </button>
        </div>
      </div>
      <div className="dm-tiles">
        {tiles.map(([k, v]) => (
          <div key={k} className="dm-tile">
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      {models.length > 0 && (
        <table className="dm-home-surveys">
          <thead>
            <tr>
              <th>Survey</th>
              <th>Questions</th>
              <th>Skip-logic branches</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              return (
                <tr key={m.name}>
                  <td>{m.survey['Survey.LongName'] || m.name}</td>
                  <td>{m.items.filter(isQuestion).length}</td>
                  <td>{m.branches.length}</td>
                  <td>
                    <button className="dm-link-btn" onClick={() => go('flowchart')}>
                      Flowchart
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {issues.length > 0 && <IssueList result={session.result} />}
    </section>
  );
}
