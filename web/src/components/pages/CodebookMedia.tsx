import { useEffect, useMemo, useRef, useState } from 'react';
import { surveyModels, isQuestion, type StudySpec } from '../../core';
import { CODEBOOK_ANCHORS, codebookItemKey } from '../../generators';
import { Box, Field } from '../ui';
import {
  formatSize,
  isPdf,
  newId,
  readDataUrl,
  sectionAfter,
  toAttachment,
  type CustomSection,
  type ExtraMedia,
  type StudyExtras,
} from '../studyExtras';


/** Big embedded videos make the codebook file big too; past this, a link is the better choice. */
const VIDEO_WARN_BYTES = 40 * 1024 * 1024;

interface Props {
  spec: StudySpec;
  extras: StudyExtras;
  setExtras(x: StudyExtras): void;
  notify(text: string, kind?: 'message' | 'error' | 'warning', ms?: number): number;
}

/** Logo, the researcher's own sections, attached documents and screenshots, for the codebook. */
export function CodebookMedia({ spec, extras, setExtras, notify }: Props) {
  const set = (patch: Partial<StudyExtras>) => setExtras({ ...extras, ...patch });
  const setSection = (id: string, patch: Partial<CustomSection>) => set({ sections: extras.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  // Question IDs and Item IDs (lower case) -> codebook keys, for matching screenshot file names.
  const keyByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const sm of surveyModels(spec))
      for (const q of sm.items.filter(isQuestion)) {
        const key = codebookItemKey(sm.name, q['Item.ID']);
        m.set(q['Item.ID'].toLowerCase(), key);
        if (q['Question.ID']) m.set(q['Question.ID'].toLowerCase(), key);
      }
    return m;
  }, [spec]);
  const [unmatched, setUnmatched] = useState<string[]>([]);

  const pickFiles = (accept: string, multiple: boolean, onFiles: (files: File[]) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => input.files && onFiles([...input.files]);
    input.click();
  };

  const addMedia = (section: CustomSection, kind: ExtraMedia['kind']) =>
    pickFiles(kind === 'image' ? 'image/*' : 'video/*', true, async (files) => {
      const added: ExtraMedia[] = [];
      for (const f of files) {
        if (kind === 'video' && f.size > VIDEO_WARN_BYTES) notify(`${f.name} is ${formatSize(f.size)}; the codebook file will be at least that big. A YouTube or Vimeo link keeps it small.`, 'warning', 9000);
        added.push({ id: newId(), kind, src: await readDataUrl(f), name: f.name, caption: '' });
      }
      setSection(section.id, { media: [...section.media, ...added] });
    });

  return (
    <>
      <Box title="Logo">
        {extras.logo ? (
          <div className="dm-media-row">
            <img className="dm-media-thumb" src={extras.logo.src} alt="Study logo" />
            <span className="dm-media-name">{extras.logo.name}</span>
            <button className="dm-link-btn" onClick={() => set({ logo: null })}>
              Remove
            </button>
          </div>
        ) : (
          <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => pickFiles('image/*', false, async ([f]) => f && set({ logo: { src: await readDataUrl(f), name: f.name } }))}>
            Add a logo
          </button>
        )}
        <p className="dm-hint">Shown above the codebook’s title.</p>
      </Box>

      <Box title="Your sections">
        <p className="dm-hint">Add your own pages to the codebook (a study setup, a protocol summary, a training video) and choose where each goes.</p>
        {extras.sections.map((s, i) => (
          <div key={s.id} className="dm-media-section">
            <div className="dm-media-section-head">
              <Draft className="dm-input" value={s.title} placeholder="Section title" onCommit={(title) => setSection(s.id, { title })} />
              <button className="dm-icon-btn" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => set({ sections: swap(extras.sections, i, i - 1) })}>
                ↑
              </button>
              <button className="dm-icon-btn" title="Move down" aria-label="Move down" disabled={i === extras.sections.length - 1} onClick={() => set({ sections: swap(extras.sections, i, i + 1) })}>
                ↓
              </button>
              <button className="dm-icon-btn" title="Delete section" aria-label="Delete section" onClick={() => set({ sections: extras.sections.filter((x) => x.id !== s.id) })}>
                ×
              </button>
            </div>
            <Field label="Goes after">
              <select className="dm-input" value={sectionAfter(s)} onChange={(e) => setSection(s.id, { after: e.target.value })}>
                <optgroup label="Codebook sections">
                  {CODEBOOK_ANCHORS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </optgroup>
                {extras.sections.length > 1 && (
                  <optgroup label="Your sections">
                    {extras.sections
                      .filter((x) => x.id !== s.id)
                      .map((x, k) => (
                        <option key={x.id} value={`section:${x.id}`}>
                          {x.title.trim() || `Untitled section ${k + 1}`}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </Field>
            <Draft multiline className="dm-input" value={s.text} placeholder="Text (a blank line starts a new paragraph)" onCommit={(text) => setSection(s.id, { text })} />
            {s.media.map((md) => (
              <div key={md.id} className="dm-media-row">
                {md.kind === 'image' ? <img className="dm-media-thumb" src={md.src} alt="" /> : <span className="dm-media-video">▶</span>}
                <Draft
                  className="dm-input"
                  value={md.caption}
                  placeholder={`Caption for ${md.name}`}
                  onCommit={(caption) => setSection(s.id, { media: s.media.map((x) => (x.id === md.id ? { ...x, caption } : x)) })}
                />
                <button className="dm-link-btn" onClick={() => setSection(s.id, { media: s.media.filter((x) => x.id !== md.id) })}>
                  Remove
                </button>
              </div>
            ))}
            <div className="dm-media-actions">
              <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => addMedia(s, 'image')}>
                Add image
              </button>
              <button className="dm-btn dm-btn-secondary dm-btn-sm" onClick={() => addMedia(s, 'video')}>
                Add video file
              </button>
              <VideoLink onAdd={(url) => setSection(s.id, { media: [...s.media, { id: newId(), kind: 'video', src: url, name: url, caption: '' }] })} />
            </div>
          </div>
        ))}
        <button
          className="dm-btn dm-btn-primary dm-btn-sm"
          onClick={() => set({ sections: [...extras.sections, { id: newId(), title: '', text: '', media: [], after: 'executiveSummary' }] })}
        >
          + Add a section
        </button>
      </Box>

      <Box title="Attached documents">
        <p className="dm-hint">
          IRB protocols, consent forms, study manuals. They go into the HTML codebook (downloadable at the end), and the AI Study Generator can read them. Word and text files are read as text;
          PDFs are sent whole to Claude.
        </p>
        {extras.attachments.map((a) => (
          <div key={a.id} className="dm-media-row">
            <span className="dm-media-doc">{isPdf(a) ? 'PDF' : (a.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'FILE').toUpperCase()}</span>
            <span className="dm-media-name">
              {a.name} <span className="dm-hint">({formatSize(a.size)}{a.text ? ', text read' : ''})</span>
            </span>
            <button className="dm-link-btn" onClick={() => set({ attachments: extras.attachments.filter((x) => x.id !== a.id) })}>
              Remove
            </button>
          </div>
        ))}
        <button
          className="dm-btn dm-btn-secondary dm-btn-sm"
          onClick={() =>
            pickFiles('.pdf,.docx,.txt,.md,.csv,.json,.rtf,.html,application/pdf,text/*', true, async (files) => {
              const added = await Promise.all(files.map(toAttachment));
              set({ attachments: [...extras.attachments, ...added] });
              const unread = added.filter((a) => !a.text && !isPdf(a));
              if (unread.length) notify(`${unread.map((a) => a.name).join(', ')}: attached, but the AI can’t read ${unread.length === 1 ? 'its' : 'their'} text (use PDF, Word or a text file for that).`, 'warning', 9000);
            })
          }
        >
          Attach documents
        </button>
      </Box>

      <Box title="Screenshots">
        <p className="dm-hint">
          Pick screenshots named after their questions (for example <code>mo_energy.png</code>, using the Question ID or Item ID). Each shows on its question’s Screenshot tab.
        </p>
        <p>
          {Object.keys(extras.screenshots).length} of {new Set(keyByName.values()).size} questions have a screenshot.
        </p>
        <div className="dm-media-actions">
          <button
            className="dm-btn dm-btn-secondary dm-btn-sm"
            onClick={() =>
              pickFiles('image/*', true, async (files) => {
                const next = { ...extras.screenshots };
                const missed: string[] = [];
                for (const f of files) {
                  const key = keyByName.get(f.name.replace(/\.[^.]+$/, '').toLowerCase());
                  if (key) next[key] = await readDataUrl(f);
                  else missed.push(f.name);
                }
                setUnmatched(missed);
                // A real screenshot replaces a made-up one.
                set({ screenshots: next, demoScreenshots: (extras.demoScreenshots ?? []).filter((k) => !files.some((f) => keyByName.get(f.name.replace(/\.[^.]+$/, '').toLowerCase()) === k)) });
                notify(`${files.length - missed.length} screenshot${files.length - missed.length === 1 ? '' : 's'} matched to questions.`);
              })
            }
          >
            Upload screenshots
          </button>
          {Object.keys(extras.screenshots).length > 0 && (
            <button className="dm-link-btn" onClick={() => (set({ screenshots: {}, demoScreenshots: [] }), setUnmatched([]))}>
              Remove all
            </button>
          )}
        </div>
        {unmatched.length > 0 && (
          <p className="dm-hint">
            No question matched: {unmatched.join(', ')}. Rename each file to its question’s ID.
          </p>
        )}
      </Box>
    </>
  );
}

function VideoLink({ onAdd }: { onAdd(url: string): void }) {
  const [url, setUrl] = useState('');
  const ok = /^https:\/\/\S+$/.test(url.trim());
  return (
    <span className="dm-media-link">
      <input className="dm-input" value={url} placeholder="or a video link (YouTube, Vimeo, .mp4)" onChange={(e) => setUrl(e.target.value)} />
      <button className="dm-btn dm-btn-secondary dm-btn-sm" disabled={!ok} onClick={() => (onAdd(url.trim()), setUrl(''))}>
        Add link
      </button>
    </span>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const out = [...list];
  [out[a], out[b]] = [out[b]!, out[a]!];
  return out;
}

/**
 * A text box that keeps its own draft and hands it up after a short pause (and when you leave it),
 * so typing doesn't push every keystroke, logo and attachment through the whole app.
 */
function Draft({ value, onCommit, multiline, ...rest }: { value: string; onCommit(v: string): void; multiline?: boolean; className?: string; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  // Take outside changes (another tab of the panel, a reload) when not mid-edit.
  useEffect(() => {
    if (!timer.current) setDraft(value);
  }, [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (v !== value) latest.current(v);
  };
  const change = (v: string) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(v), 350);
  };
  return multiline ? (
    <textarea {...rest} rows={4} value={draft} onChange={(e) => change(e.target.value)} onBlur={() => flush(draft)} />
  ) : (
    <input {...rest} value={draft} onChange={(e) => change(e.target.value)} onBlur={() => flush(draft)} />
  );
}
