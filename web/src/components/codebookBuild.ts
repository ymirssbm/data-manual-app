// Builds codebook HTML for the app (generator preview and viewer share this),
// caching rendered flowcharts and remembering the user's look and options.
import type { StudySpec, Survey } from '../core';
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

export interface CodebookSettings {
  options: CodebookOptions;
  theme: CodebookTheme;
  text: CodebookText;
}

const SETTINGS_KEY = 'data-manual:codebook-settings:v2';

/** Options and theme persist across sessions; the text fields come from the loaded study. */
export function loadSettings(spec: StudySpec | null): CodebookSettings {
  let saved: Partial<Pick<CodebookSettings, 'options' | 'theme'>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {};
  } catch {
    // No storage: defaults.
  }
  return {
    options: { ...DEFAULT_CODEBOOK_OPTIONS, ...saved.options },
    theme: { ...DEFAULT_CODEBOOK_THEME, ...saved.theme },
    text: textFromSpec(spec),
  };
}

export function saveSettings(s: CodebookSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ options: s.options, theme: s.theme }));
  } catch {
    // Not persisted; fine.
  }
}

export function textFromSpec(spec: StudySpec | null): CodebookText {
  const m = spec?.['Study.Metadata'];
  return { title: m?.['Study.Name'] ?? '', authors: m?.authors ?? '', funding: m?.funding ?? '', abstract: m?.abstract ?? '', summary: '' };
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
    for (const survey of spec.surveys) {
      const svg = await surveySvg(survey);
      if (svg) flowchartSvgs[survey['Survey.Name']] = svg;
    }
  }
  return generateCodebookHtml(spec, s.options, { flowchartSvgs, theme: s.theme }, s.text);
}
