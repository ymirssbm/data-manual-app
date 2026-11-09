// Timestamps from data sources -> RFC 3339 date-times (what the spec requires).
// Sources send all sorts: ISO with or without offset, "2022-06-02 20:15:00",
// "6/2/2022 8:15 PM" (Excel/Qualtrics/REDCap exports), Unix seconds.

/**
 * Normalize a timestamp. Times without an offset are taken as wall-clock time
 * in `timeZone` (IANA name, DST-aware) or UTC when no zone is given.
 * Returns null when the value can't be read as a date.
 */
export function toIsoDateTime(raw: string | number | null | undefined, timeZone?: string | null): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' || /^\d{9,11}(\.\d+)?$/.test(String(raw).trim())) {
    const d = new Date(Number(raw) * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('.000Z', 'Z');
  }
  const s = String(raw).trim().replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  if (/T.*([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  }
  const parts = wallClock(s);
  if (!parts) return null;
  const [y, mo, d, h, mi, sec] = parts;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const wall = `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}`;
  if (!timeZone) return `${wall}Z`;
  const offset = offsetMinutes(Date.UTC(y, mo - 1, d, h, mi, sec), timeZone);
  if (offset == null) return `${wall}Z`;
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${wall}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** [year, month, day, hour, minute, second] from ISO-like or US m/d/y strings. */
function wallClock(s: string): [number, number, number, number, number, number] | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(s);
  if (m) return valid([+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    let year = +m[3]!;
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let hour = +(m[4] ?? 0);
    const ampm = m[7]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return valid([year, +m[1]!, +m[2]!, hour, +(m[5] ?? 0), +(m[6] ?? 0)]);
  }
  return null;
}

function valid(p: [number, number, number, number, number, number]) {
  const [y, mo, d, h, mi, s] = p;
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h < 24 && mi < 60 && s < 61 && y > 1900 ? p : null;
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
