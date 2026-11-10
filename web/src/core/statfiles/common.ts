// Shared pieces for reading statistical packages' data files (SPSS, SAS, Stata) in the browser.
// Each reader returns the same table the CSV importer produces, plus what these formats carry
// that a CSV doesn't: variable labels (the question text) and value labels (the response options).

export interface ValueLabel {
  value: string;
  label: string;
}

export interface StatFile {
  /** e.g. "SPSS (.sav)". */
  format: string;
  columns: string[];
  rows: string[][];
  /** Column name -> variable label. */
  labels: Record<string, string>;
  /** Column name -> its value labels. */
  valueLabels: Record<string, ValueLabel[]>;
  /** The dataset's own label, if any. */
  fileLabel?: string;
  notes: string[];
}

/** A number as text: integers plainly, other values without floating-point noise (0.1, not 0.10000000000000001). */
export function numText(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(15)));
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Seconds since the Unix epoch -> "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS" (wall clock, no zone). */
export function isoFromEpochSeconds(s: number, withTime: boolean): string {
  if (!Number.isFinite(s)) return '';
  const d = new Date(Math.round(s * 1000));
  if (Number.isNaN(d.getTime())) return '';
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : date;
}

/** Days from 1960-01-01 (SAS and Stata's day zero) to 1970-01-01. */
export const EPOCH_1960_DAYS = 3653;

/** Decode bytes with a named encoding, falling back to Windows-1252 if the browser doesn't know it. */
export function decoder(encoding: string | undefined): TextDecoder {
  try {
    return new TextDecoder(encoding || 'windows-1252');
  } catch {
    return new TextDecoder('windows-1252');
  }
}

/** For formats that don't record their encoding: each field as UTF-8 when it is valid UTF-8, else Windows-1252. */
export function guessDecoder(): Pick<TextDecoder, 'decode'> {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const fallback = decoder('windows-1252');
  return {
    decode: (b?: AllowSharedBufferSource) => {
      try {
        return utf8.decode(b);
      } catch {
        return fallback.decode(b);
      }
    },
  };
}

/** Trailing spaces and NULs off a fixed-width text field. */
export const trimField = (s: string) => s.replace(/[\s\u0000]+$/, '');

export function ascii(u8: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return s;
}
