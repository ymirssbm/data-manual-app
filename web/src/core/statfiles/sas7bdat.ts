// SAS datasets (.sas7bdat). The format is undocumented by SAS; this follows the community
// reverse-engineering used by ReadStat (behind R's haven) and pandas: a header, then pages of
// metadata "subheaders" (row size, column names, attributes, formats and labels) and rows,
// optionally compressed with SAS's RLE ("CHAR") or RDC ("BINARY") schemes.
import { decoder, EPOCH_1960_DAYS, guessDecoder, isoFromEpochSeconds, numText, trimField, type StatFile } from './common';
import { sasDateKind } from './sasFormats';

const MAGIC = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc2, 0xea, 0x81, 0x60, 0xb3, 0x14, 0x11, 0xcf, 0xbd, 0x92, 0x08, 0x00, 0x09, 0xc7, 0x31, 0x8c, 0x18, 0x1f, 0x10, 0x11];

const ENCODINGS: Record<number, string> = { 20: 'utf-8', 28: 'us-ascii', 29: 'iso-8859-1', 30: 'iso-8859-2', 31: 'iso-8859-3', 33: 'iso-8859-5', 40: 'iso-8859-9', 60: 'windows-1250', 61: 'windows-1251', 62: 'windows-1252', 63: 'windows-1253', 64: 'windows-1254', 65: 'windows-1255', 66: 'windows-1256', 67: 'windows-1257', 68: 'windows-1258', 118: 'big5', 123: 'big5', 125: 'gb18030', 126: 'gbk', 136: 'shift_jis', 140: 'euc-kr', 141: 'euc-kr', 134: 'euc-jp', 138: 'shift_jis' };

type Sub = 'rowSize' | 'colSize' | 'counts' | 'colText' | 'colName' | 'colAttr' | 'fmtLabel' | 'colList';
// Subheader signatures (first 4 or 8 bytes), as hex.
const SIGNATURES: Record<string, Sub> = {
  f7f7f7f7: 'rowSize', '00000000f7f7f7f7': 'rowSize', f7f7f7f700000000: 'rowSize', f7f7f7f7fffffbfe: 'rowSize',
  f6f6f6f6: 'colSize', '00000000f6f6f6f6': 'colSize', f6f6f6f600000000: 'colSize', f6f6f6f6fffffbfe: 'colSize',
  '00fcffff': 'counts', fffffc00: 'counts', '00fcffffffffffff': 'counts', fffffffffffffc00: 'counts',
  fdffffff: 'colText', fffffffd: 'colText', fdffffffffffffff: 'colText', fffffffffffffffd: 'colText',
  ffffffff: 'colName', ffffffffffffffff: 'colName',
  fcffffff: 'colAttr', fffffffc: 'colAttr', fcffffffffffffff: 'colAttr', fffffffffffffffc: 'colAttr',
  fefbffff: 'fmtLabel', fffffbfe: 'fmtLabel', fefbffffffffffff: 'fmtLabel', fffffffffffffbfe: 'fmtLabel',
  feffffff: 'colList', fffffffe: 'colList', feffffffffffffff: 'colList', fffffffffffffffe: 'colList',
};

interface Column {
  name: string;
  label: string;
  format: string;
  numeric: boolean;
  offset: number;
  length: number;
}

export function readSas7bdat(buf: ArrayBuffer): StatFile {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (u8.length < 288 || MAGIC.some((b, i) => u8[i] !== b)) throw new Error('Not a SAS dataset (.sas7bdat).');
  const a2 = u8[32] === 0x33 ? 4 : 0;
  const a1 = u8[35] === 0x33 ? 4 : 0;
  const u64 = a2 === 4;
  const le = u8[37] === 0x01;
  const intLen = u64 ? 8 : 4;
  // Files often say Latin-1 (or nothing) while holding UTF-8 text, so for those, valid UTF-8 wins.
  const enc = u8[70]!;
  const dec = [0, 28, 29, 62].includes(enc) || !ENCODINGS[enc] ? guessDecoder() : decoder(ENCODINGS[enc]);
  const int = (o: number, len: number): number => {
    if (len === 1) return u8[o]!;
    if (len === 2) return dv.getUint16(o, le);
    if (len === 4) return dv.getInt32(o, le);
    return Number(dv.getBigInt64(o, le));
  };
  const headerLen = int(196 + a1, 4);
  const pageSize = int(200 + a1, 4);
  const pageCount = int(204 + a1, intLen);
  const fileLabel = trimField(dec.decode(u8.subarray(92, 156)));

  const pageBit = u64 ? 32 : 16;
  const ptrLen = u64 ? 24 : 12;
  const texts: Uint8Array[] = [];
  const names: string[] = [];
  const attrs: Array<{ offset: number; length: number; numeric: boolean }> = [];
  const fmtLabels: Array<{ format: string; label: string }> = [];
  let rowLength = 0;
  let rowCount = 0;
  let mixRowCount = 0;
  let compression: '' | 'rle' | 'rdc' = '';
  const rawRows: Uint8Array[] = [];

  const textAt = (idx: number, off: number, len: number) => {
    const t = texts[Math.min(idx, texts.length - 1)];
    return t && len > 0 ? trimField(dec.decode(t.subarray(off, off + len))) : '';
  };
  const subheader = (o: number, len: number, kind: Sub) => {
    switch (kind) {
      case 'rowSize':
        rowLength = int(o + 5 * intLen, intLen);
        rowCount = int(o + 6 * intLen, intLen);
        mixRowCount = int(o + 15 * intLen, intLen);
        break;
      case 'colText': {
        const size = int(o + intLen, 2);
        const t = u8.subarray(o + intLen, o + intLen + size);
        texts.push(t);
        if (texts.length === 1) {
          const s = String.fromCharCode(...t.subarray(0, Math.min(t.length, 256)));
          compression = s.includes('SASYZCRL') ? 'rle' : s.includes('SASYZCR2') ? 'rdc' : '';
        }
        break;
      }
      case 'colName': {
        const n = Math.floor((len - 2 * intLen - 12) / 8);
        for (let k = 0; k < n; k++) {
          const p = o + intLen + 8 * (k + 1);
          names.push(textAt(int(p, 2), int(p + 2, 2), int(p + 4, 2)));
        }
        break;
      }
      case 'colAttr': {
        const n = Math.floor((len - 2 * intLen - 12) / (intLen + 8));
        for (let k = 0; k < n; k++) {
          const p = o + intLen + 8 + k * (intLen + 8);
          attrs.push({ offset: int(p, intLen), length: int(p + intLen, 4), numeric: u8[p + intLen + 6] === 1 });
        }
        break;
      }
      case 'fmtLabel': {
        const b = o + 3 * intLen;
        fmtLabels.push({
          format: textAt(int(b + 22, 2), int(b + 24, 2), int(b + 26, 2)),
          label: textAt(int(b + 28, 2), int(b + 30, 2), int(b + 32, 2)),
        });
        break;
      }
      default:
        break;
    }
  };

  const signature = (o: number) => {
    let h = '';
    for (let k = 0; k < intLen; k++) h += u8[o + k]!.toString(16).padStart(2, '0');
    return SIGNATURES[h];
  };

  for (let pg = 0; pg < pageCount && rawRows.length < (rowCount || Infinity); pg++) {
    const base = headerLen + pg * pageSize;
    if (base + pageBit + 8 > u8.length) break;
    const type = dv.getInt16(base + pageBit, le);
    const blockCount = dv.getUint16(base + pageBit + 2, le);
    const subCount = dv.getUint16(base + pageBit + 4, le);
    if ((type & 0x9000) === 0x9000) continue; // a "comp" page: nothing to read
    const kind = type & 0x0f00;
    // Metadata pages (and mixed pages) start with subheader pointers.
    if (kind === 0x0000 || kind === 0x0200 || kind === 0x0400) {
      for (let k = 0; k < subCount; k++) {
        const ptr = base + pageBit + 8 + k * ptrLen;
        const off = int(ptr, intLen);
        const len = int(ptr + intLen, intLen);
        const comp = u8[ptr + 2 * intLen]!;
        const stype = u8[ptr + 2 * intLen + 1]!;
        if (len === 0 || comp === 1) continue; // empty or truncated
        const o = base + off;
        const known = signature(o);
        if (known) subheader(o, len, known);
        else if (compression && (comp === 4 || comp === 0) && stype === 1) {
          // A row stored as a subheader (how compressed datasets keep their rows).
          const raw = u8.subarray(o, o + len);
          rawRows.push(compression && len < rowLength ? decompress(raw, rowLength, compression) : raw);
        }
      }
    }
    if (kind === 0x0200 && rowLength > 0) {
      // Mixed page: plain rows follow the pointers, 8-byte aligned.
      let start = pageBit + 8 + subCount * ptrLen;
      start += start % 8;
      const n = Math.min(rowCount - rawRows.length, mixRowCount || Infinity, Math.floor((pageSize - start) / rowLength));
      for (let r = 0; r < n; r++) rawRows.push(u8.subarray(base + start + r * rowLength, base + start + (r + 1) * rowLength));
    } else if (kind === 0x0100 && rowLength > 0) {
      const n = Math.min(blockCount, rowCount - rawRows.length);
      for (let r = 0; r < n; r++) {
        const s = base + pageBit + 8 + r * rowLength;
        rawRows.push(u8.subarray(s, s + rowLength));
      }
    }
  }

  const columns: Column[] = attrs.map((a, i) => ({
    name: names[i] || `column_${i + 1}`,
    label: fmtLabels[i]?.label ?? '',
    format: fmtLabels[i]?.format ?? '',
    numeric: a.numeric,
    offset: a.offset,
    length: a.length,
  }));
  const kinds = columns.map((c) => (c.numeric ? sasDateKind(c.format) : null));
  const scratch = new DataView(new ArrayBuffer(8));
  const rows = rawRows.slice(0, rowCount || rawRows.length).map((row) =>
    columns.map((c, i) => {
      const b = row.subarray(c.offset, c.offset + c.length);
      if (!c.numeric) return trimField(dec.decode(b));
      // Numbers may be stored in fewer than 8 bytes: the low-order bytes were dropped.
      for (let k = 0; k < 8; k++) scratch.setUint8(k, 0);
      for (let k = 0; k < b.length; k++) scratch.setUint8(le ? 8 - b.length + k : k, b[k]!);
      const x = scratch.getFloat64(0, le);
      if (Number.isNaN(x)) return '';
      const kind = kinds[i];
      if (kind === 'date') return isoFromEpochSeconds((x - EPOCH_1960_DAYS) * 86400, false);
      if (kind === 'datetime') return isoFromEpochSeconds(x - EPOCH_1960_DAYS * 86400, true);
      return numText(x);
    }),
  );
  const labels: Record<string, string> = {};
  for (const c of columns) if (c.label) labels[c.name] = c.label;
  const notes = rowCount && rows.length < rowCount ? [`Read ${rows.length} of the ${rowCount} rows the file reports; the rest could not be read.`] : [];
  return { format: 'SAS dataset (.sas7bdat)', columns: columns.map((c) => c.name), rows, labels, valueLabels: {}, fileLabel: fileLabel || undefined, notes };
}

function decompress(src: Uint8Array, outLen: number, kind: 'rle' | 'rdc'): Uint8Array {
  return kind === 'rle' ? rle(src, outLen) : rdc(src, outLen);
}

/** SAS "CHAR" compression (SASYZCRL): commands in the high nibble, a length in the low one. */
export function rle(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let i = 0;
  let o = 0;
  const copy = (n: number) => {
    out.set(src.subarray(i, i + n), o);
    i += n;
    o += n;
  };
  const fill = (byte: number, n: number) => {
    out.fill(byte, o, Math.min(outLen, o + n));
    o += n;
  };
  while (i < src.length && o < outLen) {
    const c = src[i++]!;
    const cmd = c >> 4;
    const len = c & 0x0f;
    switch (cmd) {
      case 0:
        copy(src[i++]! + 64 + len * 256);
        break;
      case 1:
        copy(src[i++]! + 64 + len * 256 + 4096);
        break;
      case 2:
        copy(len + 96);
        break;
      case 4: {
        const n = src[i++]! + 18 + len * 256;
        fill(src[i++]!, n);
        break;
      }
      case 5:
        fill(0x40, src[i++]! + 17 + len * 256);
        break;
      case 6:
        fill(0x20, src[i++]! + 17 + len * 256);
        break;
      case 7:
        fill(0x00, src[i++]! + 17 + len * 256);
        break;
      case 8:
        copy(len + 1);
        break;
      case 9:
        copy(len + 17);
        break;
      case 10:
        copy(len + 33);
        break;
      case 11:
        copy(len + 49);
        break;
      case 12:
        fill(src[i++]!, len + 3);
        break;
      case 13:
        fill(0x40, len + 2);
        break;
      case 14:
        fill(0x20, len + 2);
        break;
      case 15:
        fill(0x00, len + 2);
        break;
      default:
        throw new Error(`Unknown SAS compression command ${cmd}.`);
    }
  }
  return out;
}

/** SAS "BINARY" compression (SASYZCR2, Ross Data Compression): runs and back-references, flagged by 16-bit control words. */
export function rdc(src: Uint8Array, outLen: number): Uint8Array {
  const out = new Uint8Array(outLen);
  let i = 0;
  let o = 0;
  let bits = 0;
  let mask = 0;
  while (i < src.length && o < outLen) {
    mask >>= 1;
    if (mask === 0) {
      bits = (src[i]! << 8) | src[i + 1]!;
      i += 2;
      mask = 0x8000;
    }
    if (!(bits & mask)) {
      out[o++] = src[i++]!;
      continue;
    }
    const cmd = src[i]! >> 4;
    let cnt = src[i]! & 0x0f;
    i++;
    if (cmd === 0) {
      cnt += 3;
      out.fill(src[i++]!, o, Math.min(outLen, o + cnt));
      o += cnt;
    } else if (cmd === 1) {
      cnt += (src[i++]! << 4) + 19;
      out.fill(src[i++]!, o, Math.min(outLen, o + cnt));
      o += cnt;
    } else if (cmd === 2) {
      const ofs = cnt + 3 + (src[i++]! << 4);
      const n = src[i++]! + 16;
      for (let k = 0; k < n && o < outLen; k++, o++) out[o] = out[o - ofs]!;
    } else {
      const ofs = cnt + 3 + (src[i++]! << 4);
      for (let k = 0; k < cmd && o < outLen; k++, o++) out[o] = out[o - ofs]!;
    }
  }
  return out;
}
