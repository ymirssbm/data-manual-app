// SPSS system files (.sav, and .zsav with zlib compression). Layout as documented by GNU PSPP
// ("System File Format"): a 176-byte header, dictionary records (variables, value labels,
// extension records), then the cases, uncompressed or bytecode-compressed.
import { decoder, isoFromEpochSeconds, numText, trimField, type StatFile, type ValueLabel } from './common';

interface SavVar {
  shortName: string;
  name: string;
  /** 0 = numeric, otherwise string width in bytes. */
  width: number;
  /** The variable label's bytes, decoded once the file's encoding is known. */
  labelRaw: Uint8Array;
  /** Print format type code (dates are 20, 22, 23, ...). */
  fmtType: number;
  missing: { values: number[]; strings: Uint8Array[]; range?: [number, number] };
  valueLabels: Array<{ raw: Uint8Array; label: Uint8Array }>;
  /** 8-byte slots this variable occupies in a case. */
  slots: number;
  /** Extra segments of a very long string (> 255 bytes), merged into this one. */
  segments: SavVar[];
  isSegment: boolean;
}

/** SPSS format types whose values are seconds since 1582-10-14. */
const DATE_TYPES = new Set([20, 23, 24, 28, 29, 30, 38, 39]);
const DATETIME_TYPES = new Set([22, 86]);
/** Seconds from 1582-10-14 (SPSS's day zero) to 1970-01-01. */
const SPSS_EPOCH = 12219379200;

const CODE_PAGES: Record<number, string> = { 65001: 'utf-8', 1252: 'windows-1252', 28591: 'iso-8859-1', 20127: 'us-ascii', 1250: 'windows-1250', 1251: 'windows-1251', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5' };

export async function readSav(buf: ArrayBuffer): Promise<StatFile> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const magic = String.fromCharCode(...u8.subarray(0, 4));
  if (magic !== '$FL2' && magic !== '$FL3') throw new Error('Not an SPSS system file.');
  const lc = dv.getInt32(64, true);
  const le = lc === 2 || lc === 3;
  const i32 = (o: number) => dv.getInt32(o, le);
  const f64 = (o: number) => dv.getFloat64(o, le);
  const compression = i32(72);
  const ncases = i32(80);
  const bias = f64(84);
  const rawFileLabel = u8.slice(109, 173);

  const vars: SavVar[] = [];
  /** Each 8-byte slot of a case -> the variable it starts, or -1 for a continuation slot. */
  const slotVar: number[] = [];
  let sysmis = -Number.MAX_VALUE;
  let encoding: string | undefined;
  let longNames = '';
  let veryLong = '';
  const docs: string[] = [];
  let p = 176;

  const recordError = () => new Error('This SPSS file is damaged or uses a layout this reader does not know.');
  for (;;) {
    if (p + 4 > u8.length) throw recordError();
    const rec = i32(p);
    p += 4;
    if (rec === 2) {
      const type = i32(p);
      const hasLabel = i32(p + 4);
      const nMissing = i32(p + 8);
      const print = i32(p + 12);
      const shortRaw = u8.slice(p + 20, p + 28);
      p += 28;
      let label = new Uint8Array();
      if (hasLabel) {
        const len = i32(p);
        label = u8.slice(p + 4, p + 4 + len);
        p += 4 + Math.ceil(len / 4) * 4;
      }
      const missing: SavVar['missing'] = { values: [], strings: [] };
      const n = Math.abs(nMissing);
      for (let k = 0; k < n; k++) {
        if (type === 0) missing.values.push(f64(p + k * 8));
        else missing.strings.push(u8.slice(p + k * 8, p + k * 8 + 8));
      }
      if (type === 0 && nMissing < 0) {
        missing.range = [missing.values[0]!, missing.values[1]!];
        missing.values = missing.values.slice(2);
      }
      p += n * 8;
      if (type === -1) {
        slotVar.push(-1);
        continue;
      }
      const shortName = trimField(String.fromCharCode(...shortRaw));
      vars.push({
        shortName,
        name: shortName,
        width: type,
        labelRaw: label,
        fmtType: (print >> 16) & 0xff,
        missing,
        valueLabels: [],
        slots: type === 0 ? 1 : Math.ceil(type / 8),
        segments: [],
        isSegment: false,
      });
      slotVar.push(vars.length - 1);
    } else if (rec === 3) {
      const count = i32(p);
      p += 4;
      const entries: Array<{ raw: Uint8Array; label: Uint8Array }> = [];
      for (let k = 0; k < count; k++) {
        const raw = u8.slice(p, p + 8);
        const len = u8[p + 8]!;
        const label = u8.slice(p + 9, p + 9 + len);
        p += 8 + Math.ceil((len + 1) / 8) * 8;
        entries.push({ raw, label });
      }
      if (i32(p) !== 4) throw recordError();
      const nv = i32(p + 4);
      p += 8;
      for (let k = 0; k < nv; k++) {
        const vi = slotVar[i32(p + k * 4) - 1];
        if (vi != null && vi >= 0) vars[vi]!.valueLabels.push(...entries);
      }
      p += nv * 4;
    } else if (rec === 6) {
      const n = i32(p);
      p += 4;
      for (let k = 0; k < n; k++) docs.push(trimField(String.fromCharCode(...u8.subarray(p + k * 80, p + k * 80 + 80))));
      p += n * 80;
    } else if (rec === 7) {
      const sub = i32(p);
      const size = i32(p + 4);
      const count = i32(p + 8);
      const start = p + 12;
      const data = u8.subarray(start, start + size * count);
      if (sub === 3 && size === 4 && count >= 8) {
        const cp = dv.getInt32(start + 7 * 4, le);
        encoding ??= CODE_PAGES[cp];
      } else if (sub === 4 && size === 8) sysmis = dv.getFloat64(start, le);
      else if (sub === 13) longNames = new TextDecoder('latin1').decode(data);
      else if (sub === 14) veryLong = new TextDecoder('latin1').decode(data);
      else if (sub === 20) encoding = new TextDecoder('latin1').decode(data).trim().toLowerCase() || encoding;
      p = start + size * count;
    } else if (rec === 999) {
      p += 4;
      break;
    } else throw recordError();
  }

  const dec = decoder(encoding);
  const text = (b: Uint8Array) => trimField(dec.decode(b));
  // Long names ("SHORT=Long name" pairs, tab-separated), decoded now the encoding is known.
  if (longNames) {
    const bytes = Uint8Array.from(longNames, (c) => c.charCodeAt(0));
    const map = new Map<string, string>();
    for (const pair of dec.decode(bytes).split('\t')) {
      const i = pair.indexOf('=');
      if (i > 0) map.set(pair.slice(0, i).trim().toUpperCase(), pair.slice(i + 1).trim());
    }
    for (const v of vars) v.name = map.get(v.shortName.toUpperCase()) ?? v.shortName;
  }
  // Very long strings: a variable of width > 255 is stored as several segments; merge them.
  if (veryLong) {
    for (const entry of veryLong.split('\t')) {
      const m = /^([^=]+)=0*(\d+)/.exec(entry.replace(/\u0000/g, ''));
      if (!m) continue;
      const width = Number(m[2]);
      const idx = vars.findIndex((v) => v.shortName.toUpperCase() === m[1]!.trim().toUpperCase());
      if (idx < 0) continue;
      const nSeg = Math.ceil(width / 252);
      for (let k = 1; k < nSeg && idx + k < vars.length; k++) {
        vars[idx + k]!.isSegment = true;
        vars[idx]!.segments.push(vars[idx + k]!);
      }
      vars[idx]!.width = width;
    }
  }

  // The case data, as a stream of 8-byte units.
  let data: Uint8Array = u8.subarray(p);
  if (compression === 2) data = await inflateZsav(u8, dv, p, le);
  const units = compression === 0 ? rawUnits(data) : bytecodeUnits(data, bias);

  const out = vars.filter((v) => !v.isSegment);
  const columns = out.map((v) => v.name);
  const rows: string[][] = [];
  const order = vars; // every variable, segments included, in slot order
  const SPACES = new Uint8Array(8).fill(0x20);
  const readString = (v: SavVar): Uint8Array | null => {
    const parts: Uint8Array[] = [];
    for (let s = 0; s < v.slots; s++) {
      const u = units.next();
      if (u.done) return null;
      parts.push(u.value.kind === 'raw' ? u.value.bytes : SPACES);
    }
    const all = new Uint8Array(parts.length * 8);
    parts.forEach((b, i) => all.set(b, i * 8));
    return all.subarray(0, v.width > 255 ? 255 : v.width);
  };
  const userMissing = (v: SavVar, x: number) => v.missing.values.includes(x) || (v.missing.range != null && x >= v.missing.range[0] && x <= v.missing.range[1]);

  outer: for (let c = 0; ncases < 0 || c < ncases; c++) {
    const row: string[] = [];
    const strings = new Map<SavVar, Uint8Array[]>();
    for (const v of order) {
      if (v.width === 0) {
        const u = units.next();
        if (u.done) break outer;
        const val = u.value;
        let x: number | null = val.kind === 'num' ? val.value : val.kind === 'raw' ? new DataView(val.bytes.buffer, val.bytes.byteOffset, 8).getFloat64(0, le) : null;
        if (x != null && (x === sysmis || x <= -Number.MAX_VALUE || Number.isNaN(x) || userMissing(v, x))) x = null;
        row.push(x == null ? '' : DATE_TYPES.has(v.fmtType) ? isoFromEpochSeconds(x - SPSS_EPOCH, false) : DATETIME_TYPES.has(v.fmtType) ? isoFromEpochSeconds(x - SPSS_EPOCH, true) : numText(x));
      } else {
        const bytes = readString(v);
        if (!bytes) break outer;
        if (v.isSegment) {
          const owner = vars.find((o) => o.segments.includes(v))!;
          strings.get(owner)!.push(bytes.subarray(0, owner.segments[owner.segments.length - 1] === v ? bytes.length : 252));
          if (owner.segments[owner.segments.length - 1] === v) {
            const segs = strings.get(owner)!;
            const total = new Uint8Array(segs.reduce((a, b) => a + b.length, 0));
            let o = 0;
            for (const s of segs) total.set(s, (o += s.length) - s.length);
            row[out.indexOf(owner)] = text(total);
          }
          continue;
        }
        if (v.segments.length) {
          strings.set(v, [bytes.subarray(0, 252)]);
          row.push('');
          continue;
        }
        const s = text(bytes);
        const missingString = v.missing.strings.some((m) => text(m) === s);
        row.push(missingString ? '' : s);
      }
    }
    rows.push(row);
  }

  const labels: Record<string, string> = {};
  const valueLabels: Record<string, ValueLabel[]> = {};
  for (const v of out) {
    const lab = text(v.labelRaw);
    if (lab) labels[v.name] = lab;
    if (v.valueLabels.length) {
      valueLabels[v.name] = v.valueLabels.map(({ raw, label }) => ({
        value: v.width === 0 ? numText(new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, le)) : text(raw),
        label: text(label),
      }));
    }
  }
  const notes: string[] = [];
  if (out.some((v) => v.missing.values.length || v.missing.range || v.missing.strings.length)) notes.push("Values SPSS marks as user-missing were read as missing.");
  if (docs.length) notes.push(`The file has ${docs.length} line(s) of SPSS documentation.`);
  return { format: compression === 2 ? 'SPSS (.zsav)' : 'SPSS (.sav)', columns, rows, labels, valueLabels, fileLabel: text(rawFileLabel) || undefined, notes };
}

type Unit = { kind: 'num'; value: number } | { kind: 'raw'; bytes: Uint8Array } | { kind: 'spaces' } | { kind: 'sysmis' };

function* rawUnits(data: Uint8Array): Generator<Unit, void> {
  for (let p = 0; p + 8 <= data.length; p += 8) yield { kind: 'raw', bytes: data.subarray(p, p + 8) };
}

/** Bytecode compression: blocks of 8 command bytes, each a small integer, a code, or "8 raw bytes follow". */
function* bytecodeUnits(data: Uint8Array, bias: number): Generator<Unit, void> {
  let p = 0;
  for (;;) {
    if (p + 8 > data.length) return;
    const cmd = data.subarray(p, p + 8);
    p += 8;
    for (const c of cmd) {
      if (c === 0) continue;
      if (c === 252) return;
      if (c === 253) {
        if (p + 8 > data.length) return;
        yield { kind: 'raw', bytes: data.subarray(p, p + 8) };
        p += 8;
      } else if (c === 254) yield { kind: 'spaces' };
      else if (c === 255) yield { kind: 'sysmis' };
      else yield { kind: 'num', value: c - bias };
    }
  }
}

/** .zsav: the bytecode stream split into zlib blocks, listed in a trailer. */
async function inflateZsav(u8: Uint8Array, dv: DataView, p: number, le: boolean): Promise<Uint8Array> {
  const i64 = (o: number) => Number(dv.getBigInt64(o, le));
  const trailerOfs = i64(p + 8);
  const nBlocks = dv.getInt32(trailerOfs + 20, le);
  const parts: Uint8Array[] = [];
  for (let b = 0; b < nBlocks; b++) {
    const e = trailerOfs + 24 + b * 24;
    const compOfs = i64(e + 8);
    const compSize = dv.getInt32(e + 20, le);
    const stream = new Blob([u8.slice(compOfs, compOfs + compSize)]).stream().pipeThrough(new DecompressionStream('deflate'));
    parts.push(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
