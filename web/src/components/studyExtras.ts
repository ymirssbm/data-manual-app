// What a researcher adds to a codebook beyond the study spec: a logo, their own sections (text,
// images, video), attached documents (an IRB protocol, a consent form) and question screenshots.
// Kept per study in this browser (IndexedDB, so images and PDFs fit), with the study details text.
import { unzipSync, strFromU8 } from 'fflate';
import { mockScreenSvg, codebookItemKey, type CodebookText } from '../generators';
import { isQuestion, surveyModels, type StudySpec } from '../core';

/** Where older saved sections were placed, before they could follow any section. */
const LEGACY_AFTER: Record<string, string> = { start: 'titlePage', afterSummary: 'contact', beforeVariables: 'studyAdherence', end: 'variableList' };

export interface ExtraMedia {
  id: string;
  /** image: a picture; video: a video file or link (YouTube, Vimeo or a direct .mp4/.webm). */
  kind: 'image' | 'video';
  /** data: URL for an uploaded file, or an https URL. */
  src: string;
  name: string;
  caption: string;
}

export interface CustomSection {
  id: string;
  title: string;
  text: string;
  media: ExtraMedia[];
  /** The section it comes after: a built-in one (CODEBOOK_ANCHORS key) or `section:<id>`. */
  after: string;
  /** Older saves: a fixed position instead of `after`. */
  position?: string;
}

/** A section's anchor, for sections saved before `after` existed too. */
export const sectionAfter = (s: CustomSection) => s.after || LEGACY_AFTER[s.position ?? ''] || 'executiveSummary';

export interface Attachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  /** The file as a data: URL, so the codebook can carry it and the AI can read it. */
  dataUrl: string;
  /** Plain text pulled out of text and Word files (empty for PDFs and other files). */
  text: string;
}

export interface StudyExtras {
  logo: { src: string; name: string } | null;
  sections: CustomSection[];
  attachments: Attachment[];
  /** Uploaded question screenshots, by codebookItemKey. */
  screenshots: Record<string, string>;
  /** Screenshot keys that are made-up demonstrations (the example study's), not real ones. */
  demoScreenshots?: string[];
}

export const EMPTY_EXTRAS: StudyExtras = { logo: null, sections: [], attachments: [], screenshots: {} };

export const EXAMPLE_STUDY_NAME = 'Recovery Pathways EMA (branching example)';

/** The example study's made-up screenshots: a drawn phone screen per question, to show the feature. */
export function demoScreenshots(spec: StudySpec): Pick<StudyExtras, 'screenshots' | 'demoScreenshots'> {
  const screenshots: Record<string, string> = {};
  for (const m of surveyModels(spec))
    for (const q of m.items.filter(isQuestion)) screenshots[codebookItemKey(m.name, q['Item.ID'])] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mockScreenSvg(q, m.label))}`;
  return { screenshots, demoScreenshots: Object.keys(screenshots) };
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

const TEXT_TYPES = /\.(txt|md|markdown|csv|tsv|json|ya?ml|r|rmd|py|sps|sas|do|html?)$/i;

/** Text an AI (or a reader) can use: the file itself for text files, the document text for .docx. */
export async function extractText(file: File): Promise<string> {
  if (TEXT_TYPES.test(file.name) || file.type.startsWith('text/')) return file.text();
  if (/\.docx$/i.test(file.name)) {
    try {
      const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === 'word/document.xml' });
      const xml = files['word/document.xml'];
      if (!xml) return '';
      return strFromU8(xml)
        .replace(/<\/w:p>/g, '\n')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch {
      return '';
    }
  }
  return '';
}

export async function toAttachment(file: File): Promise<Attachment> {
  return {
    id: newId(),
    name: file.name,
    mediaType: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream'),
    size: file.size,
    dataUrl: await readDataUrl(file),
    text: await extractText(file),
  };
}

export const isPdf = (a: Pick<Attachment, 'name' | 'mediaType'>) => a.mediaType === 'application/pdf' || /\.pdf$/i.test(a.name);

export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- Per-study storage (IndexedDB: images and documents are too big for localStorage)

interface Saved {
  extras: StudyExtras;
  /** Study details typed on the Codebook page (title, authors, funding, contact, abstract, summary). */
  text?: CodebookText;
  /** Variables left out of the codebook. */
  exclude?: string[];
}

const DB = 'data-manual';
const STORE = 'study-extras';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** What was saved for this study (by study name), or null. Never throws: storage may be unavailable. */
export async function loadStudyExtras(studyName: string): Promise<Saved | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(studyName);
      req.onsuccess = () => resolve((req.result as Saved | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveStudyExtras(studyName: string, saved: Saved): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(saved, studyName);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Private windows can block IndexedDB; the page still works, it just won't remember.
  }
}
