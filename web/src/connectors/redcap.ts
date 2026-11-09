// REDCap API pull: project info + data dictionary (metadata) + records,
// translated into the spec with the same code that reads REDCap file downloads.
import { validateSpec, type StudySpec, type ValidationResult } from '../core';
import { redcapDictionaryToSpec, redcapRecordsToData } from '../translators/redcap';
import { ConnectorError, errorText, relayFetch } from './relay';

export interface RedcapPull {
  /** API URL, e.g. https://redcap.example.edu/api/ */
  url: string;
  token: string;
  includeRecords: boolean;
  timeZone?: string;
  signal?: AbortSignal;
  onStatus?(s: string): void;
}

export function normalizeRedcapUrl(raw: string): string {
  let u = raw.trim();
  if (!u) throw new ConnectorError('Enter your REDCap API URL (it ends in /api/).');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  if (url.protocol !== 'https:') throw new ConnectorError('The REDCap URL must start with https://');
  if (!/\/api\/?$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/?$/, '/') + 'api/';
  return url.toString();
}

async function call(url: string, token: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const body = new URLSearchParams({ token: token.trim(), format: 'json', returnFormat: 'json', ...params }).toString();
  const res = await relayFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal });
  if (res.status === 403 || res.status === 401) throw new ConnectorError('REDCap rejected the API token (or the token lacks API export rights for this project).');
  if (!res.ok) throw new ConnectorError(`REDCap error (${res.status}): ${await errorText(res)}`);
  try {
    return await res.json();
  } catch {
    throw new ConnectorError('REDCap returned something that isn\'t JSON. Check the API URL.');
  }
}

export async function pullRedcap({ url, token, includeRecords, timeZone, signal, onStatus }: RedcapPull): Promise<{ result: ValidationResult; notes: string[]; title: string }> {
  if (!token.trim()) throw new ConnectorError('Enter your REDCap API token.');
  const api = normalizeRedcapUrl(url);
  onStatus?.('Reading project…');
  const project = (await call(api, token, { content: 'project' }, signal)) as Record<string, string>;
  const title = project?.project_title || 'REDCap project';
  onStatus?.('Reading data dictionary…');
  const metadata = (await call(api, token, { content: 'metadata' }, signal)) as Array<Record<string, string>>;
  if (!Array.isArray(metadata) || !metadata.length) throw new ConnectorError('The project has no fields (empty data dictionary).');
  const { spec, notes } = redcapDictionaryToSpec(metadata, title);
  const s = spec as unknown as StudySpec;
  if (project?.purpose_other || project?.project_notes) s['Study.Metadata'].abstract = project.project_notes || project.purpose_other;
  if (includeRecords) {
    onStatus?.('Reading records…');
    const records = (await call(api, token, { content: 'record', type: 'flat', rawOrLabel: 'raw', rawOrLabelHeaders: 'raw', exportSurveyFields: 'true', exportDataAccessGroups: 'false' }, signal)) as Array<Record<string, string>>;
    const { data, notes: dataNotes } = redcapRecordsToData(Array.isArray(records) ? records : [], s, { timeZone });
    if ((data['Question.ID'] as unknown[]).length) s.data = data as unknown as StudySpec['data'];
    notes.push(...dataNotes);
  }
  return { result: validateSpec(s), notes, title };
}

/** Check a project token and get the project's title (used when adding a project to "My REDCap projects"). */
export async function redcapProjectInfo(url: string, token: string, signal?: AbortSignal): Promise<{ url: string; title: string; projectId: string }> {
  if (!token.trim()) throw new ConnectorError('Enter the project\'s API token.');
  const api = normalizeRedcapUrl(url);
  const p = (await call(api, token, { content: 'project' }, signal)) as Record<string, string>;
  return { url: api, title: p?.project_title || 'REDCap project', projectId: String(p?.project_id ?? '') };
}
