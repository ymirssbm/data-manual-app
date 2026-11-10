// Stata datasets (.dta): releases 113-115 (Stata 8-13, fixed binary layout) and 117-119
// (Stata 13-18, tagged sections), per Stata's "dta" file format documentation.
import { decoder, EPOCH_1960_DAYS, guessDecoder, isoFromEpochSeconds, numText, trimField, type StatFile, type ValueLabel } from './common';

interface DtaVar {
  name: string;
  type: number;
  format: string;
  labelSet: string;
  label: string;
}

export function readDta(buf: ArrayBuffer): StatFile {
  const u8 = new Uint8Array(buf);
  const head = String.fromCharCode(...u8.subarray(0, 11));
  return head === '<stata_dta>' ? readNew(u8) : readOld(u8);
}

// ---- Stata 13+ (117, 118, 119)

function readNew(u8: Uint8Array): StatFile {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const text = String.fromCharCode(...u8.subarray(0, 300));
  const release = Number(/<release>(\d+)<\/release>/.exec(text)?.[1]);
  if (![117, 118, 119].includes(release)) throw new Error(`Stata release ${release || '?'} files aren't supported.`);
  const le = /<byteorder>LSF<\/byteorder>/.test(text);
  // 118+ are UTF-8 by definition; older files are Latin-1 officially, but writers often use UTF-8.
  const dec = release >= 118 ? decoder('utf-8') : guessDecoder();
  const find = (tag: string, from = 0) => {
    const t = Array.from(tag, (c) => c.charCodeAt(0));
    outer: for (let i = from; i <= u8.length - t.length; i++) {
      for (let k = 0; k < t.length; k++) if (u8[i + k] !== t[k]) continue outer;
      return i + t.length;
    }
    throw new Error(`This Stata file is missing its ${tag} section.`);
  };
  let p = find('<K>');
  const nvar = release === 119 ? dv.getUint32(p, le) : dv.getUint16(p, le);
  p = find('<N>', p);
  const nobs = release === 117 ? dv.getUint32(p, le) : Number(dv.getBigUint64(p, le));
  p = find('<label>', p);
  const labLen = release === 117 ? u8[p]! : dv.getUint16(p, le);
  const lw = release === 117 ? 1 : 2;
  const fileLabel = trimField(dec.decode(u8.subarray(p + lw, p + lw + labLen)));

  // The map: offsets of each section, so the rest can be read directly.
  p = find('<map>', p);
  const off = (k: number) => Number(dv.getBigUint64(p + k * 8, le));
  const nameLen = release === 117 ? 33 : 129;
  const fmtLen = release === 117 ? 49 : 57;
  const vlabLen = release === 117 ? 81 : 321;
  const str = (o: number, n: number) => trimField(dec.decode(u8.subarray(o, o + n)).split('\u0000')[0]!);

  const typesAt = off(2) + '<variable_types>'.length;
  const namesAt = off(3) + '<varnames>'.length;
  const fmtsAt = off(5) + '<formats>'.length;
  const lblNamesAt = off(6) + '<value_label_names>'.length;
  const varLabelsAt = off(7) + '<variable_labels>'.length;
  const vars: DtaVar[] = [];
  for (let i = 0; i < nvar; i++) {
    vars.push({
      type: dv.getUint16(typesAt + i * 2, le),
      name: str(namesAt + i * nameLen, nameLen),
      format: str(fmtsAt + i * fmtLen, fmtLen),
      labelSet: str(lblNamesAt + i * nameLen, nameLen),
      label: str(varLabelsAt + i * vlabLen, vlabLen),
    });
  }

  // Long strings (strL) live in their own section, referenced from the data by (variable, observation).
  const strls = new Map<string, string>();
  let q = off(10) + '<strls>'.length;
  const strlsEnd = off(11);
  while (q + 3 <= strlsEnd && u8[q] === 0x47 && u8[q + 1] === 0x53 && u8[q + 2] === 0x4f) {
    const v = dv.getUint32(q + 3, le);
    const o = release === 117 ? dv.getUint32(q + 7, le) : Number(dv.getBigUint64(q + 7, le));
    const at = q + 3 + 4 + (release === 117 ? 4 : 8);
    const t = u8[at]!;
    const len = dv.getUint32(at + 1, le);
    const body = u8.subarray(at + 5, at + 5 + len);
    strls.set(`${v}:${o}`, t === 130 ? trimField(dec.decode(body).replace(/\u0000$/, '')) : `[binary, ${len} bytes]`);
    q = at + 5 + len;
  }

  const width = (t: number) => (t <= 2045 ? t : t === 32768 ? 8 : t === 65526 ? 8 : t === 65527 ? 4 : t === 65528 ? 4 : t === 65529 ? 2 : 1);
  const rows: string[][] = [];
  let r = off(9) + '<data>'.length;
  for (let i = 0; i < nobs; i++) {
    const row: string[] = [];
    for (const v of vars) {
      const w = width(v.type);
      if (v.type <= 2045) row.push(trimField(dec.decode(u8.subarray(r, r + w)).split('\u0000')[0]!));
      else if (v.type === 32768) {
        const key =
          release === 117
            ? `${dv.getUint32(r, le)}:${dv.getUint32(r + 4, le)}`
            : release === 118
              ? `${dv.getUint16(r, le)}:${Number(dv.getBigUint64(r, le) >> 16n)}`
              : `${dv.getUint32(r, le) & 0xffffff}:${Number(dv.getBigUint64(r, le) >> 24n)}`;
        row.push(strls.get(key) ?? '');
      } else row.push(numberCell(dv, r, v.type, le, v.format));
      r += w;
    }
    rows.push(row);
  }

  // Value labels: <lbl> blocks, each a named set of value -> label pairs.
  const sets = new Map<string, ValueLabel[]>();
  let l = off(11) + '<value_labels>'.length;
  const end = off(12);
  while (l + 5 < end && String.fromCharCode(...u8.subarray(l, l + 5)) === '<lbl>') {
    const len = dv.getInt32(l + 5, le);
    const name = str(l + 9, nameLen);
    const table = l + 9 + nameLen + 3;
    sets.set(name, labelTable(u8, dv, table, le, dec));
    l = l + 9 + len + nameLen + 3 + '</lbl>'.length;
  }
  return finish(vars, rows, sets, fileLabel, `Stata ${release === 117 ? 13 : release === 118 ? '14-18' : '15-18 (large)'} (.dta)`);
}

// ---- Stata 8-12 (113, 114, 115)

function readOld(u8: Uint8Array): StatFile {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const release = u8[0]!;
  if (![113, 114, 115].includes(release)) throw new Error('Not a Stata dataset, or a Stata version this reader does not know.');
  const le = u8[1] === 2;
  const dec = guessDecoder();
  const nvar = dv.getUint16(4, le);
  const nobs = dv.getUint32(6, le);
  const fileLabel = trimField(dec.decode(u8.subarray(10, 91)).split('\u0000')[0]!);
  const str = (o: number, n: number) => trimField(dec.decode(u8.subarray(o, o + n)).split('\u0000')[0]!);
  let p = 109;
  const types = Array.from(u8.subarray(p, p + nvar));
  p += nvar;
  const names = types.map((_, i) => str(p + i * 33, 33));
  p += nvar * 33 + (nvar + 1) * 2;
  const fl = release === 113 ? 12 : 49;
  const formats = types.map((_, i) => str(p + i * fl, fl));
  p += nvar * fl;
  const sets = types.map((_, i) => str(p + i * 33, 33));
  p += nvar * 33;
  const labels = types.map((_, i) => str(p + i * 81, 81));
  p += nvar * 81;
  // Expansion fields: (type, length, data) until a zero type.
  while (p < u8.length && u8[p] !== 0) p += 5 + dv.getInt32(p + 1, le);
  p += 5;
  // Old type codes -> new ones, so one cell reader serves both.
  const map: Record<number, number> = { 251: 65530, 252: 65529, 253: 65528, 254: 65527, 255: 65526 };
  const vars: DtaVar[] = types.map((t, i) => ({ type: t <= 244 ? t : map[t]!, name: names[i]!, format: formats[i]!, labelSet: sets[i]!, label: labels[i]! }));
  const width = (t: number) => (t <= 2045 ? t : t === 65526 ? 8 : t === 65527 || t === 65528 ? 4 : t === 65529 ? 2 : 1);
  const rows: string[][] = [];
  for (let i = 0; i < nobs; i++) {
    const row: string[] = [];
    for (const v of vars) {
      const w = width(v.type);
      row.push(v.type <= 2045 ? str(p, w) : numberCell(dv, p, v.type, le, v.format));
      p += w;
    }
    rows.push(row);
  }
  const valueSets = new Map<string, ValueLabel[]>();
  while (p + 40 <= u8.length) {
    const len = dv.getInt32(p, le);
    const name = str(p + 4, 33);
    const table = p + 4 + 33 + 3;
    if (len <= 0 || table + len > u8.length) break;
    valueSets.set(name, labelTable(u8, dv, table, le, dec));
    p = table + len;
  }
  return finish(vars, rows, valueSets, fileLabel, `Stata ${release === 113 ? '8-9' : release === 114 ? 10 : '11-12'} (.dta)`);
}

// ---- Shared

/** One numeric cell; Stata's missing values (., .a-.z) are the largest values of each type. */
function numberCell(dv: DataView, o: number, type: number, le: boolean, format: string): string {
  let x: number;
  if (type === 65530) {
    x = dv.getInt8(o);
    if (x > 100) return '';
  } else if (type === 65529) {
    x = dv.getInt16(o, le);
    if (x > 32740) return '';
  } else if (type === 65528) {
    x = dv.getInt32(o, le);
    if (x > 2147483620) return '';
  } else if (type === 65527) {
    x = dv.getFloat32(o, le);
    if (!(x <= 1.701e38)) return '';
    x = Number(x.toPrecision(7));
  } else {
    x = dv.getFloat64(o, le);
    if (!(x <= 8.988e307)) return '';
  }
  const f = format.toLowerCase();
  if (/^%-?t?d/.test(f) && !/^%-?tc/i.test(format)) return isoFromEpochSeconds((x - EPOCH_1960_DAYS) * 86400, false);
  if (/^%-?tc/i.test(format)) return isoFromEpochSeconds(x / 1000 - EPOCH_1960_DAYS * 86400, true);
  return numText(x);
}

function labelTable(u8: Uint8Array, dv: DataView, t: number, le: boolean, dec: Pick<TextDecoder, 'decode'>): ValueLabel[] {
  const n = dv.getInt32(t, le);
  const txtLen = dv.getInt32(t + 4, le);
  const offs = t + 8;
  const vals = offs + 4 * n;
  const txt = vals + 4 * n;
  const out: ValueLabel[] = [];
  for (let k = 0; k < n; k++) {
    const o = dv.getInt32(offs + 4 * k, le);
    if (o < 0 || o >= txtLen) continue;
    let e = txt + o;
    while (e < txt + txtLen && u8[e] !== 0) e++;
    out.push({ value: String(dv.getInt32(vals + 4 * k, le)), label: dec.decode(u8.subarray(txt + o, e)) });
  }
  return out;
}

function finish(vars: DtaVar[], rows: string[][], sets: Map<string, ValueLabel[]>, fileLabel: string, format: string): StatFile {
  const labels: Record<string, string> = {};
  const valueLabels: Record<string, ValueLabel[]> = {};
  for (const v of vars) {
    if (v.label) labels[v.name] = v.label;
    const set = v.labelSet ? sets.get(v.labelSet) : undefined;
    if (set?.length) valueLabels[v.name] = set;
  }
  return { format, columns: vars.map((v) => v.name), rows, labels, valueLabels, fileLabel: fileLabel || undefined, notes: [] };
}
