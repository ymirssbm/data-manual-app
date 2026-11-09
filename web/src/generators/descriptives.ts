// Response descriptives from the spec's long-format `data` block
// (parallel arrays: one position per delivered question).
import { labelForValue, type Question, type StudySpec } from '../core';

export interface FrequencyRow {
  value: string;
  label: string;
  count: number;
  percent: number;
}

export interface NumericSummary {
  n: number;
  mean: number;
  sd: number;
  min: number;
  median: number;
  max: number;
  /** Histogram bins over [min, max]. */
  bins: Array<{ from: number; to: number; count: number }>;
}

export interface MissingnessSummary {
  /** Missing responses per participant: min / max / mean / SD. */
  min: number;
  max: number;
  mean: number;
  sd: number;
  /**
   * ICC(1) of the missing/answered indicator across participants (one-way
   * random effects). The prior tool's formula could exceed 1; this one can't.
   * null when it can't be estimated (one participant, or no variation).
   */
  icc: number | null;
}

export interface ParticipantRate {
  participant: string;
  delivered: number;
  answered: number;
}

export interface DayRate {
  /** YYYY-MM-DD */
  date: string;
  delivered: number;
  answered: number;
}

export interface OutlierSummary {
  q1: number;
  median: number;
  q3: number;
  /** Tukey fences: q1 - 1.5*IQR and q3 + 1.5*IQR. */
  lower: number;
  upper: number;
  min: number;
  max: number;
  /** All answered values (for the dot strip), with who gave them. */
  points: Array<{ value: number; participant: string }>;
  /** Values outside the fences, most extreme first. */
  flagged: Array<{ value: number; participant: string; z: number }>;
}

export interface ItemDescriptives {
  delivered: number;
  answered: number;
  missing: number;
  /** Participants who were delivered this item. */
  participants: number;
  /** Participants who answered it at least once. */
  participantsAnswered: number;
  /** Participants anywhere in the data set. */
  totalParticipants: number;
  missingness: MissingnessSummary | null;
  /** Response rate per participant, lowest first. */
  byParticipant: ParticipantRate[];
  /** Response rate per day of the study (when the data has dates). */
  byDay: DayRate[];
  /** Outlier screen for numeric items. */
  outliers: OutlierSummary | null;
  frequencies: FrequencyRow[] | null;
  numeric: NumericSummary | null;
}

export interface DataOverview {
  firstDate: string | null;
  lastDate: string | null;
  devices: string[];
  timezones: string[];
  participants: number;
}

type Response = { value: string | null; participant: string | null; date?: string | null };

const MISSING = new Set(['', 'na', 'n/a', 'null', 'nan', 'no response', '%%']);
const isMissing = (v: string | null | undefined) => v == null || MISSING.has(String(v).trim().toLowerCase());

/** Index responses by Question.ID once, so per-item lookups are cheap. */
export function indexResponses(spec: StudySpec): Map<string, Response[]> {
  const d = spec.data;
  const out = new Map<string, Response[]>();
  if (!d?.['Question.ID'] || !d['User.Response']) return out;
  const qids = d['Question.ID'];
  const resp = d['User.Response'];
  const pids = d['Participant.ID'] ?? [];
  const dates = d['Survey.Date.Completed'] ?? [];
  for (let i = 0; i < qids.length; i++) {
    const q = qids[i];
    if (q == null) continue;
    const list = out.get(q) ?? [];
    list.push({ value: resp[i] ?? null, participant: pids[i] ?? null, date: dates[i] ? String(dates[i]).slice(0, 10) : null });
    out.set(q, list);
  }
  return out;
}

export function hasResponseData(spec: StudySpec): boolean {
  return (spec.data?.['Question.ID']?.length ?? 0) > 0;
}

/** Study-level facts derived from the data (collection period, devices, timezones). */
export function dataOverview(spec: StudySpec): DataOverview | null {
  const d = spec.data;
  if (!d || !hasResponseData(spec)) return null;
  const dates = (d['Survey.Date.Completed'] ?? []).map((s) => (s ? String(s).slice(0, 10) : '')).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
  const uniq = (xs: Array<string | null | undefined> | undefined) => [...new Set((xs ?? []).filter((x): x is string => !!x && x !== 'NA'))];
  return {
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    devices: uniq(d.Model),
    timezones: uniq(d.Timezone),
    participants: uniq(d['Participant.ID']).length,
  };
}

export function describeItem(q: Question, responses: Response[] | undefined, totalParticipants = 0): ItemDescriptives | null {
  if (!responses || responses.length === 0) return null;
  const answered = responses.filter((r) => !isMissing(r.value));
  const type = q['Question.Type.Display.Name'];
  const base = {
    delivered: responses.length,
    answered: answered.length,
    missing: responses.length - answered.length,
    participants: new Set(responses.map((r) => r.participant).filter(Boolean)).size,
    participantsAnswered: new Set(answered.map((r) => r.participant).filter(Boolean)).size,
    totalParticipants,
    missingness: missingness(responses),
    byParticipant: rates(responses, (r) => r.participant ?? '').map(([participant, x]) => ({ participant, ...x })).sort((a, b) => a.answered / a.delivered - b.answered / b.delivered),
    byDay: rates(responses.filter((r) => r.date), (r) => r.date!).map(([date, x]) => ({ date, ...x })).sort((a, b) => a.date.localeCompare(b.date)),
    outliers: null as OutlierSummary | null,
  };

  if (type === 'Multiple Choice' || type === 'Multiple Select') {
    // Multiple Select responses can hold several values ("1,3" / "1;3" / "1|3").
    const counts = new Map<string, number>();
    for (const r of answered) {
      const values = type === 'Multiple Select' ? String(r.value).split(/[,;|]/) : [String(r.value)];
      for (const v of values.map((x) => x.trim()).filter(Boolean)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    const known = (q.responseKey ?? []).map((r) => String(r.value));
    const values = [...known, ...[...counts.keys()].filter((v) => !known.includes(v)).sort()];
    return {
      ...base,
      numeric: null,
      frequencies: values.map((v) => ({
        value: v,
        label: labelForValue(q, v),
        count: counts.get(v) ?? 0,
        percent: ((counts.get(v) ?? 0) / total) * 100,
      })),
    };
  }

  if (type === 'Slider' || type === 'Time Scale Slider' || q['Data.Type'] === 'numeric' || q['Data.Type'] === 'integer') {
    const nums = answered.map((r) => Number(r.value)).filter(Number.isFinite);
    if (nums.length) {
      const pts = answered.filter((r) => Number.isFinite(Number(r.value))).map((r) => ({ value: Number(r.value), participant: r.participant ?? '' }));
      return { ...base, frequencies: null, numeric: summarize(nums), outliers: outlierScreen(pts) };
    }
  }
  return { ...base, frequencies: null, numeric: null };
}

function missingness(responses: Response[]): MissingnessSummary | null {
  const byPerson = new Map<string, number[]>();
  for (const r of responses) {
    const p = r.participant ?? '';
    const list = byPerson.get(p) ?? [];
    list.push(isMissing(r.value) ? 1 : 0);
    byPerson.set(p, list);
  }
  const perPerson = [...byPerson.values()].map((xs) => xs.reduce((a, b) => a + b, 0));
  if (!perPerson.length) return null;
  const mean = perPerson.reduce((a, b) => a + b, 0) / perPerson.length;
  const sd = perPerson.length > 1 ? Math.sqrt(perPerson.reduce((a, b) => a + (b - mean) ** 2, 0) / (perPerson.length - 1)) : 0;
  return { min: Math.min(...perPerson), max: Math.max(...perPerson), mean, sd, icc: icc1([...byPerson.values()]) };
}

function rates(responses: Response[], key: (r: Response) => string): Array<[string, { delivered: number; answered: number }]> {
  const m = new Map<string, { delivered: number; answered: number }>();
  for (const r of responses) {
    const k = key(r);
    const x = m.get(k) ?? { delivered: 0, answered: 0 };
    x.delivered++;
    if (!isMissing(r.value)) x.answered++;
    m.set(k, x);
  }
  return [...m.entries()];
}

function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (i - lo);
}

/** Tukey fences (1.5 * IQR) on the answered values; z-scores reported for context. */
export function outlierScreen(points: Array<{ value: number; participant: string }>): OutlierSummary | null {
  if (points.length < 5) return null;
  const sorted = points.map((p) => p.value).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const sd = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, sorted.length - 1)) || 1;
  const flagged = points
    .filter((p) => p.value < lower || p.value > upper)
    .map((p) => ({ ...p, z: (p.value - mean) / sd }))
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return { q1, median: quantile(sorted, 0.5), q3, lower, upper, min: sorted[0]!, max: sorted[sorted.length - 1]!, points, flagged };
}

/** One-way random-effects ICC(1) with unequal group sizes. */
export function icc1(groups: number[][]): number | null {
  const g = groups.filter((x) => x.length > 0);
  const N = g.reduce((a, x) => a + x.length, 0);
  if (g.length < 2 || N <= g.length) return null;
  const grand = g.reduce((a, x) => a + x.reduce((s, v) => s + v, 0), 0) / N;
  const means = g.map((x) => x.reduce((s, v) => s + v, 0) / x.length);
  const ssb = g.reduce((a, x, i) => a + x.length * (means[i]! - grand) ** 2, 0);
  const ssw = g.reduce((a, x, i) => a + x.reduce((s, v) => s + (v - means[i]!) ** 2, 0), 0);
  const msb = ssb / (g.length - 1);
  const msw = ssw / (N - g.length);
  const n0 = (N - g.reduce((a, x) => a + x.length ** 2, 0) / N) / (g.length - 1);
  const denom = msb + (n0 - 1) * msw;
  if (denom <= 0) return null;
  return Math.max(0, Math.min(1, (msb - msw) / denom));
}

export function summarize(nums: number[], binCount = 10): NumericSummary {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const median = n % 2 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const width = (max - min) / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
  for (const v of sorted) bins[Math.min(binCount - 1, Math.floor((v - min) / width))]!.count++;
  return { n, mean, sd, min, median, max, bins };
}
