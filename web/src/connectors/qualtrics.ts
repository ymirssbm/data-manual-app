// Qualtrics API pull: survey definition (QSF) + response export, translated into
// the spec with the same code that reads .qsf files.
// Docs: survey-definitions/{id}?format=qsf, and the 3-step response export
// (start export -> poll progress -> download file).
import { validateSpec, type StudySpec, type ValidationResult } from '../core';
import { qualtricsResponsesToData, qualtricsToSpec } from '../translators/qualtrics';
import { ConnectorError, errorText, relayFetch } from './relay';

export interface QualtricsPull {
  /** Datacenter ID (e.g. "iad1", "ca1", "yul1") or full https://<dc>.qualtrics.com URL. */
  datacenter: string;
  surveyId: string;
  token: string;
  includeResponses: boolean;
  signal?: AbortSignal;
  onStatus?(s: string): void;
}

export function qualtricsBase(datacenter: string): string {
  const d = datacenter.trim().replace(/\/+$/, '');
  if (!d) throw new ConnectorError('Enter your Qualtrics datacenter ID (find it under Account Settings → Qualtrics IDs).');
  if (/^https:\/\/[\w.-]+\.qualtrics\.com$/i.test(d)) return d;
  if (/^[a-z0-9-]+$/i.test(d)) return `https://${d}.qualtrics.com`;
  throw new ConnectorError('The datacenter should look like "iad1" or "https://iad1.qualtrics.com".');
}

async function api(base: string, path: string, token: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<Record<string, unknown>> {
  const res = await relayFetch(`${base}/API/v3/${path}`, {
    method: init.method ?? 'GET',
    signal: init.signal,
    headers: { 'x-api-token': token.trim(), accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw new ConnectorError('Qualtrics rejected the API token. Check the token, and that the datacenter matches your account.');
  if (res.status === 404) throw new ConnectorError('Survey not found. Check the survey ID (it starts with SV_) and the datacenter.');
  if (!res.ok) throw new ConnectorError(`Qualtrics error (${res.status}): ${await errorText(res)}`);
  return (await res.json()) as Record<string, unknown>;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, fail) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), fail(new DOMException('Aborted', 'AbortError'))), { once: true });
  });

export async function pullQualtrics({ datacenter, surveyId, token, includeResponses, signal, onStatus }: QualtricsPull): Promise<{ result: ValidationResult; notes: string[] }> {
  const id = surveyId.trim();
  if (!/^SV_\w+$/.test(id)) throw new ConnectorError('Enter the survey ID; it starts with SV_ (Survey → Tools → Import/Export, or the survey URL).');
  if (!token.trim()) throw new ConnectorError('Enter your Qualtrics API token (Account Settings → Qualtrics IDs).');
  const base = qualtricsBase(datacenter);

  onStatus?.('Reading survey definition…');
  const def = await api(base, `survey-definitions/${encodeURIComponent(id)}?format=qsf`, token, { signal });
  const { spec, notes, survey } = qualtricsToSpec(def);
  const s = spec as unknown as StudySpec;

  if (includeResponses) {
    onStatus?.('Starting response export…');
    const start = await api(base, `surveys/${id}/export-responses`, token, { method: 'POST', body: { format: 'json', compress: false, useLabels: false }, signal });
    const progressId = (start.result as Record<string, unknown>)?.progressId as string;
    let fileId: string | undefined;
    for (let i = 0; i < 120 && !fileId; i++) {
      const p = (await api(base, `surveys/${id}/export-responses/${progressId}`, token, { signal })).result as Record<string, unknown>;
      onStatus?.(`Exporting responses… ${Math.round(Number(p?.percentComplete ?? 0))}%`);
      if (p?.status === 'failed') throw new ConnectorError('Qualtrics could not export the responses.');
      if (p?.status === 'complete') fileId = p.fileId as string;
      else await sleep(1000, signal);
    }
    if (!fileId) throw new ConnectorError('The response export took too long. Try again in a minute.');
    onStatus?.('Downloading responses…');
    const res = await relayFetch(`${base}/API/v3/surveys/${id}/export-responses/${fileId}/file`, { headers: { 'x-api-token': token.trim() }, signal });
    if (!res.ok) throw new ConnectorError(`Qualtrics error (${res.status}): ${await errorText(res)}`);
    const exported = JSON.parse(await res.text());
    const qids = new Set((s.surveys[0]?.questions ?? []).filter((q) => q['Item.Type'] === 'Question').map((q) => q['Item.ID']));
    const { data, notes: dn } = qualtricsResponsesToData(exported, survey, qids);
    if ((data['Question.ID'] as unknown[]).length) s.data = data as unknown as StudySpec['data'];
    notes.push(...dn);
  }
  return { result: validateSpec(s), notes };
}

export interface QualtricsSurveySummary {
  id: string;
  name: string;
  isActive: boolean;
  lastModified: string;
  creationDate: string;
}

/** Every survey the token's account can see (GET /surveys, following nextPage). */
export async function listQualtricsSurveys(datacenter: string, token: string, signal?: AbortSignal): Promise<QualtricsSurveySummary[]> {
  if (!token.trim()) throw new ConnectorError('Enter your Qualtrics API token.');
  const base = qualtricsBase(datacenter);
  const out: QualtricsSurveySummary[] = [];
  let path: string | null = 'surveys';
  for (let i = 0; path && i < 50; i++) {
    const page = (await api(base, path, token, { signal })).result as { elements?: Array<Record<string, unknown>>; nextPage?: string | null };
    for (const e of page?.elements ?? []) {
      out.push({ id: String(e.id), name: String(e.name ?? e.id), isActive: !!e.isActive, lastModified: String(e.lastModified ?? ''), creationDate: String(e.creationDate ?? '') });
    }
    const next = page?.nextPage;
    path = next ? next.replace(/^https:\/\/[^/]+\/API\/v3\//, '') : null;
  }
  return out.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}
