// SAS transport files (.xpt), versions 5 and 8 (SAS's "XPORT" format, as used for FDA
// submissions and by haven/ReadStat). Fixed 80-byte header records, a "namestr" per variable,
// then the observations; numbers are IBM mainframe floating point.
import { ascii, EPOCH_1960_DAYS, guessDecoder, isoFromEpochSeconds, numText, trimField, type StatFile } from './common';
import { sasDateKind } from './sasFormats';

interface XptVar {
  name: string;
  label: string;
  format: string;
  numeric: boolean;
  length: number;
  pos: number;
}

const HEADER = 'HEADER RECORD*******';

export function readXpt(buf: ArrayBuffer): StatFile {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const rec = (i: number) => ascii(u8, i, 80);
  if (!rec(0).startsWith(`${HEADER}LIBRARY HEADER RECORD`) && !rec(0).startsWith(`${HEADER}LIBV8   HEADER RECORD`)) throw new Error('Not a SAS transport (.xpt) file.');
  const isHeader = (o: number) => o + 20 <= u8.length && ascii(u8, o, 20) === HEADER;
  const headerName = (o: number) => ascii(u8, o + 20, 8).trim();

  // Walk the 80-byte records to the first member's pieces.
  let o = 0;
  let namestrLen = 140;
  let namestrStart = -1;
  let labelsStart = -1;
  let labelsKind = '';
  let obsStart = -1;
  let memberCount = 0;
  for (; o + 80 <= u8.length; o += 80) {
    if (!isHeader(o)) continue;
    const name = headerName(o);
    if (name === 'MEMBER' || name === 'MEMBV8') {
      memberCount++;
      if (memberCount > 1) break;
      namestrLen = Number(rec(o).slice(74, 78)) || 140;
    } else if (name === 'NAMESTR' || name === 'NAMSTV8') namestrStart = o + 80;
    else if (name === 'LABELV8' || name === 'LABELV9') {
      labelsStart = o + 80;
      labelsKind = name;
    } else if (name === 'OBS' || name === 'OBSV8') {
      obsStart = o + 80;
      break;
    }
  }
  if (namestrStart < 0 || obsStart < 0) throw new Error('This SAS transport file has no dataset in it.');
  // Another member after this one ends the data; otherwise it runs to the end of the file.
  let obsEnd = u8.length;
  for (let k = obsStart; k + 80 <= u8.length; k += 80) {
    if (isHeader(k) && (headerName(k) === 'MEMBER' || headerName(k) === 'MEMBV8')) {
      obsEnd = k;
      memberCount++;
      break;
    }
  }

  const namestrEnd = labelsStart > 0 ? labelsStart - 80 : obsStart - 80;
  const count = Math.floor((namestrEnd - namestrStart) / namestrLen);
  const dec = guessDecoder();
  const vars: XptVar[] = [];
  for (let k = 0; k < count; k++) {
    const b = namestrStart + k * namestrLen;
    const ntype = dv.getInt16(b, false);
    if (ntype !== 1 && ntype !== 2) break;
    const short = trimField(dec.decode(u8.subarray(b + 8, b + 16)));
    const long = namestrLen >= 120 ? trimField(dec.decode(u8.subarray(b + 88, b + 120))) : '';
    vars.push({
      name: long || short,
      label: trimField(dec.decode(u8.subarray(b + 16, b + 56))),
      format: trimField(ascii(u8, b + 56, 8)),
      numeric: ntype === 1,
      length: dv.getInt16(b + 4, false),
      pos: dv.getInt32(b + 84, false),
    });
  }
  // Version 8/9: labels longer than 40 characters come in their own section.
  if (labelsStart > 0) {
    const n = Number(rec(labelsStart - 80).slice(48).trim()) || 0;
    let q = labelsStart;
    for (let k = 0; k < n && q + 6 <= obsStart; k++) {
      const vi = dv.getInt16(q, false) - 1;
      if (labelsKind === 'LABELV8') {
        const nameLen = dv.getInt16(q + 2, false);
        const labelLen = dv.getInt16(q + 4, false);
        q += 6;
        const label = dec.decode(u8.subarray(q + nameLen, q + nameLen + labelLen));
        if (vars[vi]) vars[vi]!.label = trimField(label);
        q += nameLen + labelLen;
      } else {
        const nameLen = dv.getInt16(q + 2, false);
        const fmtLen = dv.getInt16(q + 4, false);
        const infmtLen = dv.getInt16(q + 6, false);
        const labelLen = dv.getInt16(q + 8, false);
        q += 10;
        const label = dec.decode(u8.subarray(q + nameLen, q + nameLen + labelLen));
        const format = ascii(u8, q + nameLen + labelLen, fmtLen);
        if (vars[vi]) {
          vars[vi]!.label = trimField(label);
          if (format.trim()) vars[vi]!.format = format.trim();
        }
        q += nameLen + labelLen + fmtLen + infmtLen;
      }
    }
  }

  const obsLen = vars.reduce((m, v) => Math.max(m, v.pos + v.length), 0);
  const rows: string[][] = [];
  if (obsLen > 0) {
    // The last record is padded with spaces; a "row" that is all padding isn't data.
    let nRows = Math.floor((obsEnd - obsStart) / obsLen);
    const blank = (r: number) => u8.subarray(obsStart + r * obsLen, obsStart + (r + 1) * obsLen).every((b) => b === 0x20);
    while (nRows > 0 && blank(nRows - 1)) nRows--;
    const kinds = vars.map((v) => (v.numeric ? sasDateKind(v.format) : null));
    for (let r = 0; r < nRows; r++) {
      const base = obsStart + r * obsLen;
      rows.push(
        vars.map((v, i) => {
          const b = u8.subarray(base + v.pos, base + v.pos + v.length);
          if (!v.numeric) return trimField(dec.decode(b));
          const x = ibmToDouble(b);
          if (x == null) return '';
          const kind = kinds[i];
          if (kind === 'date') return isoFromEpochSeconds((x - EPOCH_1960_DAYS) * 86400, false);
          if (kind === 'datetime') return isoFromEpochSeconds(x - EPOCH_1960_DAYS * 86400, true);
          return numText(x);
        }),
      );
    }
  }
  const labels: Record<string, string> = {};
  for (const v of vars) if (v.label) labels[v.name] = v.label;
  const notes = memberCount > 1 ? ['This transport file holds more than one dataset; only the first was read.'] : [];
  return { format: 'SAS transport (.xpt)', columns: vars.map((v) => v.name), rows, labels, valueLabels: {}, notes };
}

/** IBM 370 hexadecimal floating point (2 to 8 bytes, big-endian) -> a number, or null for a SAS missing value. */
export function ibmToDouble(b: Uint8Array): number | null {
  const bytes = new Uint8Array(8);
  bytes.set(b.subarray(0, 8));
  const b0 = bytes[0]!;
  const restZero = bytes.subarray(1).every((x) => x === 0);
  // Missing: ".", "._" or ".A"-".Z" in the first byte, zeros after.
  if (restZero && (b0 === 0x2e || b0 === 0x5f || (b0 >= 0x41 && b0 <= 0x5a))) return null;
  if (restZero && (b0 & 0x7f) === 0) return 0;
  const sign = b0 & 0x80 ? -1 : 1;
  const exp = (b0 & 0x7f) - 64;
  const hi = bytes[1]! * 65536 + bytes[2]! * 256 + bytes[3]!;
  const lo = bytes[4]! * 16777216 + bytes[5]! * 65536 + bytes[6]! * 256 + bytes[7]!;
  const mant = (hi * 4294967296 + lo) / 72057594037927936; // 2^56
  return sign * mant * Math.pow(16, exp);
}
