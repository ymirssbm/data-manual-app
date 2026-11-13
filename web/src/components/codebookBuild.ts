// Builds codebook HTML for the app (generator preview and viewer share this),
// caching rendered flowcharts and remembering the user's look and options.
import { flowKnown, type StudySpec, type Survey } from '../core';
import {
  DEFAULT_CODEBOOK_OPTIONS,
  DEFAULT_CODEBOOK_THEME,
  generateCodebookHtml,
  generateFlowchart,
  type CodebookOptions,
  type CodebookText,
  type CodebookTheme,
} from '../generators';
import { renderMermaid } from './util';
import { EMPTY_EXTRAS, sectionAfter, type StudyExtras } from './studyExtras';

export interface CodebookSettings {
  options: CodebookOptions;
  theme: CodebookTheme;
  text: CodebookText;
  /** Variables left out of this study's codebook (codebookItemKey keys). Saved per study. */
  exclude: string[];
  /** Logo, the researcher's sections, attached documents and screenshots. Saved per study. */
  extras: StudyExtras;
}

const SETTINGS_KEY = 'data-manual:codebook-settings:v5';
/**
 * Older settings carry over, except changed defaults: charts use the accent colour (v3), and the
 * study name and authors start checked again, with funding and contact as their own sections (v5).
 */
const OLD_SETTINGS_KEYS = ['data-manual:codebook-settings:v4', 'data-manual:codebook-settings:v3', 'data-manual:codebook-settings:v2'];

/** Options and theme persist across sessions; the text fields come from the loaded study. */
export function loadSettings(spec: StudySpec | null): CodebookSettings {
  let saved: Partial<Pick<CodebookSettings, 'options' | 'theme'>> = {};
  try {
    const current = localStorage.getItem(SETTINGS_KEY);
    if (current) saved = JSON.parse(current) ?? {};
    else {
      const raw = OLD_SETTINGS_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
      const old = JSON.parse(raw ?? '{}') ?? {};
      saved = {
        options: old.options ? { ...old.options, nameOfStudy: true, authors: true, funding: true, contact: true } : undefined,
        theme: old.theme ? { ...old.theme, charts: 'accent' } : undefined,
      };
    }
  } catch {
    // No storage: defaults.
  }
  return {
    options: { ...DEFAULT_CODEBOOK_OPTIONS, ...saved.options },
    theme: { ...DEFAULT_CODEBOOK_THEME, ...saved.theme },
    text: textFromSpec(spec),
    exclude: [],
    extras: EMPTY_EXTRAS,
  };
}

export function saveSettings(s: CodebookSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ options: s.options, theme: s.theme }));
  } catch {
    // Not persisted; fine.
  }
}

/**
 * Study details after the study was edited (not replaced): fields the user typed over are kept;
 * fields still showing the old study's value follow the edit.
 */
export function textAfterEdit(current: CodebookText, before: StudySpec | null, after: StudySpec | null): CodebookText {
  const was = textFromSpec(before);
  const now = textFromSpec(after);
  const pick = (k: keyof CodebookText) => ((current[k] ?? '') === (was[k] ?? '') ? now[k] : current[k]);
  return { title: pick('title'), authors: pick('authors'), funding: pick('funding'), contact: pick('contact'), abstract: pick('abstract'), summary: current.summary };
}

export function textFromSpec(spec: StudySpec | null): CodebookText {
  const m = spec?.['Study.Metadata'];
  const contact = (m as { 'Data.Access'?: { Contact?: string } } | undefined)?.['Data.Access']?.Contact ?? '';
  return { title: m?.['Study.Name'] ?? '', authors: m?.authors ?? '', funding: m?.funding ?? '', contact, abstract: m?.abstract ?? '', summary: '' };
}

// Flowcharts are the slow part, so each survey is rendered once per loaded study.
const svgCache = new WeakMap<Survey, Promise<string | null>>();
function surveySvg(survey: Survey): Promise<string | null> {
  let p = svgCache.get(survey);
  if (!p) {
    p = renderMermaid(generateFlowchart(survey)).catch(() => null);
    svgCache.set(survey, p);
  }
  return p;
}

export async function buildCodebook(spec: StudySpec, s: CodebookSettings): Promise<string> {
  const flowchartSvgs: Record<string, string> = {};
  if (s.options.flowcharts) {
    for (const survey of spec.surveys.filter(flowKnown)) {
      const svg = await surveySvg(survey);
      if (svg) flowchartSvgs[survey['Survey.Name']] = svg;
    }
  }
  const x = s.extras;
  return generateCodebookHtml(
    spec,
    s.options,
    {
      flowchartSvgs,
      theme: s.theme,
      excludeItems: s.exclude,
      logo: x.logo?.src,
      customSections: x.sections.map((s) => ({ ...s, after: sectionAfter(s) })),
      attachments: x.attachments.map((a) => ({ name: a.name, mediaType: a.mediaType, size: a.size, href: a.dataUrl, text: a.text })),
      screenshots: x.screenshots,
      demoScreenshots: x.demoScreenshots,
    },
    s.text,
  );
}
