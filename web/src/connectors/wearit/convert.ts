// Wear-IT getData pages -> study spec. Pure: no network, no DOM.
//
// The API returns pages of JSON. Metadata comes with the pages:
//   "Block IDs Map":       { <survey>: { "Item 1": {question fields} | {"Item 2": {...}, ...} (a block) } }
//   "Survey Response Key": { <surveyId>: { <Question ID>: { "<Type> Key": [ { <value>: <label> }, ... ] } } }
// and every page has "data": [ { participant/session fields..., "User Responses": [ {...} ] } ]
// plus "links": { "next": <url> } for pagination.
// Key spellings vary (spaces/underscores/dots), so all keys are compared normalized.
import { buildBlockMap, stripHtml, type Survey } from '../../core';
import { WEARIT_TYPES } from './questionTypes';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const get = (o: Obj, ...names: string[]): unknown => {
  const wanted = new Set(names.map(norm));
  for (const [k, v] of Object.entries(o)) if (wanted.has(norm(k))) return v;
  return undefined;
};
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const spaced = (s: string) => s.replace(/_/g, ' ').trim();
const isItemKey = (k: string) => /^item[\s_]*\w+/i.test(k);

export interface WearitConvertOptions {
  studyId?: string;
}

export interface WearitConvertResult {
  spec: Obj;
  notes: string[];
}

export function wearitPagesToSpec(input: unknown, opts: WearitConvertOptions = {}): WearitConvertResult {
  const pages = (Array.isArray(input) ? input : [input]).filter(isObj);
  if (!pages.length) throw new Error('No Wear-IT data pages found.');
  const notes: string[] = [];

  const meta = pages.find((p) => get(p, 'Block IDs Map') != null) ?? pages[0]!;
  const blockMapRaw = get(meta, 'Block IDs Map');
  if (!isObj(blockMapRaw)) throw new Error('The Wear-IT response has no "Block IDs Map", so survey structure is unknown.');

  const responseKeys = indexResponseKeys(get(meta, 'Survey Response Key'));
  const approximated = new Map<string, number>();
  const surveys: Obj[] = [];

  for (const [surveyKey, surveyBody] of Object.entries(blockMapRaw)) {
    if (!isObj(surveyBody)) continue;
    const surveyName = spaced(surveyKey);
    const items: Obj[] = [];

    const visit = (key: string, body: unknown, parent: string | null) => {
      if (!isObj(body)) return;
      const itemId = spaced(key);
      const childKeys = Object.keys(body).filter(isItemKey);
      if (childKeys.length) {
        // A block: its children are items (or nested blocks).
        items.push({
          'Item.ID': itemId,
          'Question.ID': itemId,
          'Question.Type.Display.Name': 'Block',
          'Item.Type': 'Block',
          Parent: parent,
        });
        for (const ck of childKeys) visit(ck, body[ck], itemId);
        return;
      }
      items.push(toQuestion(itemId, body, parent, responseKeys, approximated));
    };
    for (const [k, v] of Object.entries(surveyBody)) visit(k, v, null);

    resolveConditionals(items);
    surveys.push({ 'Survey.Name': surveyName, 'Survey.LongName': surveyName, questions: items });
  }

  for (const [name, n] of approximated) notes.push(`${n} "${name}" item(s) mapped to the closest available question type.`);

  const data = collectData(pages, notes);
  const studyName = opts.studyId ? `Wear-IT study ${opts.studyId}` : 'Wear-IT study';
  const spec: Obj = {
    'Study.Metadata': { 'Study.Name': studyName },
    schedules: [],
    surveys,
    blockMap: buildBlockMap(surveys as unknown as Survey[]),
  };
  if (data) spec.data = data;
  notes.push(`Pulled ${surveys.length} survey(s) and ${data ? data['Question.ID']!.length.toLocaleString() : 0} responses from ${pages.length} page(s).`);
  notes.push('Schedules aren\'t part of the getData response; add them to the spec if you want a schedule page.');
  return { spec, notes };
}

type ResponseKeyIndex = Map<string, { responses: Array<{ value: string; definition: string }>; sliders: string[] }>;

/** Survey Response Key -> per Question ID: response options and multi-slider labels. */
function indexResponseKeys(raw: unknown): ResponseKeyIndex {
  const out: ResponseKeyIndex = new Map();
  if (!isObj(raw)) return out;
  for (const survey of Object.values(raw)) {
    if (!isObj(survey)) continue;
    for (const [qid, q] of Object.entries(survey)) {
      if (!isObj(q)) continue;
      const entry = out.get(spaced(qid)) ?? { responses: [], sliders: [] };
      for (const [keyType, sets] of Object.entries(q)) {
        const kind = norm(keyType.replace(/key$/i, ''));
        const pairs: Array<[string, string]> = [];
        for (const set of Array.isArray(sets) ? sets : [sets]) {
          if (isObj(set)) for (const [v, d] of Object.entries(set)) pairs.push([v, d == null ? '' : String(d)]);
        }
        if (kind.includes('slider') && kind.includes('multi')) entry.sliders.push(...pairs.map(([, d]) => d).filter(Boolean));
        else if (kind === 'response' || kind === '') {
          for (const [value, definition] of pairs) {
            if (!entry.responses.some((r) => r.value === value)) entry.responses.push({ value, definition: stripHtml(definition) });
          }
        }
      }
      entry.responses.sort((a, b) => (Number(a.value) - Number(b.value)) || a.value.localeCompare(b.value));
      out.set(spaced(qid), entry);
    }
  }
  return out;
}

function toQuestion(itemId: string, body: Obj, parent: string | null, keys: ResponseKeyIndex, approximated: Map<string, number>): Obj {
  const qid = str(get(body, 'Question ID', 'QuestionID', 'Question')) ?? itemId;
  const code = Number(get(body, 'Question Type'));
  const t = WEARIT_TYPES[code];
  const display = t?.spec ?? (str(get(body, 'Question Type Display Name')) ?? 'Free Response');
  if (t?.approx) approximated.set(t.name, (approximated.get(t.name) ?? 0) + 1);

  if (display === 'End Block') {
    return { 'Item.ID': itemId, 'Question.ID': qid, 'Question.Type.Display.Name': 'End Block', 'Item.Type': 'Question', Parent: parent, 'Question.Text': '', 'Data.Type': null, responseKey: [] };
  }
  const rk = keys.get(qid);
  const q: Obj = {
    'Item.ID': itemId,
    'Question.ID': qid,
    'Question.Text': stripHtml(str(get(body, 'Question Text')) ?? ''),
    'Question.Type.Display.Name': display,
    'Item.Type': 'Question',
    Parent: parent,
    'Data.Type': t ? t.resultType : null,
    responseKey: rk?.responses ?? [],
  };
  const descr: string[] = [];
  if (t?.approx) descr.push(`Wear-IT type: ${t.name}.`);
  if (rk?.sliders.length) descr.push(`Sliders: ${rk.sliders.join('; ')}.`);
  if (descr.length) q['Question.Description'] = descr.join(' ');

  // Raw conditional fields; resolved to real Item.IDs once the whole survey is known.
  const cond: Obj = {};
  const children = str(get(body, 'Conditional Child Item ID'));
  if (children) cond._children = children;
  const defs = str(get(body, 'Definitions'));
  if (defs) cond._definitions = defs;
  const fail = str(get(body, 'Conditional Fail Item ID'));
  if (fail) cond['Conditional.Fail.Item.ID'] = fail;
  const master = str(get(body, 'Conditional Master Item ID'));
  if (master) cond['Conditional.Master.Item.ID'] = master;
  const threshold = str(get(body, 'Conditional Threshold'));
  if (threshold) cond['Conditional.Threshold'] = threshold;
  const ctype = str(get(body, 'Conditional Type'));
  if (ctype && /^[1-6]$/.test(ctype)) cond['Conditional.Type'] = ctype;
  const multi = get(body, 'Multi Conditional');
  if (multi === true || multi === 'TRUE' || multi === 'true') cond['Multi.Conditional'] = true;
  const limit = Number(get(body, 'Conditional Limit'));
  if (Number.isInteger(limit) && limit > 0) cond['Conditional.Limit'] = limit;
  if (Object.keys(cond).length) q['Conditional.Info'] = cond;
  return q;
}

/** Child/fail/master IDs come as bare numbers ("5745") or lists ("5745, 5746"); resolve to Item.IDs. */
function resolveConditionals(items: Obj[]) {
  const ids = new Set(items.map((i) => String(i['Item.ID'])));
  const resolve = (raw: string): string | null => {
    const v = raw.trim();
    if (!v) return null;
    if (ids.has(v)) return v;
    if (ids.has(`Item ${v}`)) return `Item ${v}`;
    return null;
  };
  for (const item of items) {
    const ci = item['Conditional.Info'] as Obj | undefined;
    if (!ci) continue;
    if (typeof ci._children === 'string') {
      const children = ci._children.split(/[;,]/).map(resolve).filter((x): x is string => !!x);
      const groups = typeof ci._definitions === 'string' ? ci._definitions.split(';').map((g) => g.trim()) : [];
      const rk = (item.responseKey as Array<{ value: string; definition: string }>) ?? [];
      const threshold = ci['Conditional.Threshold'] as string | undefined;
      const fallback = threshold ? (rk.find((r) => r.value === threshold)?.definition ?? threshold) : '';
      ci['Conditional.Child.Mappings'] = children.flatMap((child, i) => {
        const defs = (groups[i] ?? '').split('|').map((d) => d.trim()).filter(Boolean);
        return (defs.length ? defs : [fallback]).map((d) => ({ 'Conditional.Child.Item.ID': child, Definition: d }));
      });
      if (!(ci['Conditional.Child.Mappings'] as unknown[]).length) delete ci['Conditional.Child.Mappings'];
    }
    delete ci._children;
    delete ci._definitions;
    for (const k of ['Conditional.Fail.Item.ID', 'Conditional.Master.Item.ID']) {
      if (typeof ci[k] === 'string') {
        const r = resolve(ci[k] as string);
        if (r) ci[k] = r;
        else delete ci[k];
      }
    }
    if (!Object.keys(ci).length) delete item['Conditional.Info'];
  }
}

/**
 * Wear-IT timestamps come as local wall-clock times without an offset
 * ("2022-06-02 20:15:00"). The spec wants RFC 3339, so attach the offset of
 * the record's IANA timezone at that moment (DST-aware). With no timezone,
 * the time is treated as UTC. Returns null for unparseable input.
 */
export function toIsoDateTime(raw: string | null, timeZone: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(' ', 'T');
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', sec = '00'] = m;
  const wall = `${y}-${mo}-${d}T${h}:${mi}:${sec}`;
  if (!timeZone) return `${wall}Z`;
  const offset = offsetMinutes(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +sec), timeZone);
  if (offset == null) return `${wall}Z`;
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${wall}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** UTC offset (minutes) of `timeZone` at the given wall-clock time, or null for an unknown zone. */
function offsetMinutes(wallAsUtcMs: number, timeZone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const at = (ms: number) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
    };
    // Two passes so times near a DST switch resolve to the right side.
    let guess = wallAsUtcMs - (at(wallAsUtcMs) - wallAsUtcMs);
    guess = wallAsUtcMs - (at(guess) - guess);
    return Math.round((wallAsUtcMs - guess) / 60000);
  } catch {
    return null;
  }
}

/** All pages' data records -> the spec's long-format column vectors. */
function collectData(pages: Obj[], notes: string[]): Record<string, unknown[]> | null {
  const cols: Record<string, unknown[]> = {
    'Participant.ID': [], 'Session.ID': [], 'Survey.Date.Completed': [], 'Survey.Date.Submitted': [],
    Timezone: [], Offset: [], OS: [], Model: [], 'App.Version': [], 'External.ID': [], 'Question.ID': [], 'User.Response': [],
  };
  let skippedEmpty = 0;
  let skippedUndated = 0;
  for (const page of pages) {
    const records = get(page, 'data');
    if (!Array.isArray(records)) continue;
    for (const rec of records) {
      if (!isObj(rec)) continue;
      const responses = get(rec, 'User Responses');
      if (!Array.isArray(responses) || !responses.length) {
        skippedEmpty++;
        continue;
      }
      const tz = str(get(rec, 'Timezone', 'Time Zone'));
      const submitted = toIsoDateTime(str(get(rec, 'Survey Date Submitted')), tz);
      const completed = toIsoDateTime(str(get(rec, 'Survey Date Completed')), tz) ?? submitted;
      if (!completed) {
        skippedUndated++;
        continue;
      }
      const ext = get(rec, 'External ID', 'External IDs');
      const shared = {
        'Participant.ID': str(get(rec, 'Participant ID')) ?? '',
        'Session.ID': Number(get(rec, 'Session ID')),
        'Survey.Date.Completed': completed,
        'Survey.Date.Submitted': submitted ?? completed,
        Timezone: tz ?? '',
        Offset: Number(get(rec, 'Offset')),
        OS: str(get(rec, 'OS')) ?? '',
        Model: str(get(rec, 'Model')) ?? '',
        'App.Version': str(get(rec, 'App Version')) ?? '',
        'External.ID': Array.isArray(ext) ? String(ext[0] ?? '') : isObj(ext) ? String(Object.values(ext)[0] ?? '') : (str(ext) ?? ''),
      };
      for (const r of responses) {
        if (!isObj(r)) continue;
        for (const [k, v] of Object.entries(shared)) cols[k]!.push(v);
        cols['Question.ID']!.push(str(get(r, 'Question ID', 'Question')) ?? '');
        const resp = get(r, 'User Response');
        cols['User.Response']!.push(resp == null ? '' : Array.isArray(resp) ? resp.join(',') : String(resp));
      }
    }
  }
  if (skippedEmpty) notes.push(`Skipped ${skippedEmpty} session(s) with no responses.`);
  if (skippedUndated) notes.push(`Skipped ${skippedUndated} session(s) with no valid completion or submission time.`);
  if (!cols['Question.ID']!.length) return null;
  // Columns the platform didn't send are dropped rather than kept as blanks.
  for (const k of Object.keys(cols)) {
    const v = cols[k]!;
    if (k === 'Session.ID' || k === 'Offset') {
      if (v.every((x) => !Number.isFinite(x as number))) delete cols[k];
      else cols[k] = v.map((x) => (Number.isFinite(x as number) ? x : 0));
    } else if (!['Participant.ID', 'Survey.Date.Completed', 'Question.ID', 'User.Response'].includes(k) && v.every((x) => x === '')) {
      delete cols[k];
    }
  }
  if (!cols['Session.ID']) cols['Session.ID'] = cols['Question.ID']!.map(() => 0);
  return cols;
}
