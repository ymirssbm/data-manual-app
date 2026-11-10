// R data files: .rds (saveRDS) and .RData/.rda (save). Both hold R's serialization format
// ("R Internals", section 1.8), usually gzip-compressed. This reads the parts data frames are
// made of: vectors, lists, attributes, factors, dates, and ALTREP compact sequences, plus
// variable and value labels from haven/labelled ("label" and "labels" attributes).
import { decoder, isoFromEpochSeconds, numText, type StatFile, type ValueLabel } from './common';

// SEXP types
const NILSXP = 0, SYMSXP = 1, LISTSXP = 2, CLOSXP = 3, ENVSXP = 4, PROMSXP = 5, LANGSXP = 6, SPECIALSXP = 7, BUILTINSXP = 8, CHARSXP = 9,
  LGLSXP = 10, INTSXP = 13, REALSXP = 14, CPLXSXP = 15, STRSXP = 16, DOTSXP = 17, VECSXP = 19, EXPRSXP = 20, BCODESXP = 21, EXTPTRSXP = 22,
  WEAKREFSXP = 23, RAWSXP = 24, S4SXP = 25;
// Pseudo-types used only in the stream
const REFSXP = 255, NILVALUE_SXP = 254, GLOBALENV_SXP = 253, UNBOUNDVALUE_SXP = 252, MISSINGARG_SXP = 251, BASENAMESPACE_SXP = 250,
  NAMESPACESXP = 249, PACKAGESXP = 248, PERSISTSXP = 247, EMPTYENV_SXP = 242, BASEENV_SXP = 241, ATTRLANGSXP = 240, ATTRLISTSXP = 239, ALTREP_SXP = 238;
const NA_INT = -2147483648;

/** An R object, reduced to what a data frame needs. */
interface RObj {
  type: number;
  /** Vector contents: numbers (with null for NA), strings (null for NA), or child objects. */
  data?: Array<number | null> | Array<string | null> | RObj[];
  attrs?: Map<string, RObj>;
  /** Pairlist entries (tag -> value). */
  pairs?: Array<{ tag: string | null; value: RObj }>;
  /** Symbol or single string. */
  name?: string;
}
const NIL: RObj = { type: NILSXP };

class Reader {
  private dv: DataView;
  private p = 0;
  private refs: RObj[] = [];
  private enc: TextDecoder;
  constructor(private u8: Uint8Array) {
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.enc = decoder('utf-8');
  }
  int() {
    const v = this.dv.getInt32(this.p, false);
    this.p += 4;
    return v;
  }
  double() {
    const v = this.dv.getFloat64(this.p, false);
    this.p += 8;
    return v;
  }
  length() {
    const n = this.int();
    if (n !== -1) return n;
    const hi = this.int();
    const lo = this.int();
    return hi * 4294967296 + (lo >>> 0);
  }
  header() {
    const fmt = String.fromCharCode(this.u8[0]!, this.u8[1]!);
    if (fmt !== 'X\n') throw new Error(fmt === 'A\n' ? 'This R file was saved in ASCII format; re-save it with saveRDS(x) or save(x, file = ...) using the defaults.' : 'Not an R serialized file.');
    this.p = 2;
    const version = this.int();
    this.int(); // writer R version
    this.int(); // minimal reader version
    if (version === 3) {
      const n = this.int();
      const enc = String.fromCharCode(...this.u8.subarray(this.p, this.p + n));
      this.p += n;
      try {
        this.enc = new TextDecoder(enc.toLowerCase() === 'latin1' ? 'windows-1252' : enc);
      } catch {
        this.enc = decoder('utf-8');
      }
    } else if (version !== 2) throw new Error(`R serialization version ${version} isn't supported.`);
  }
  item(): RObj {
    const flags = this.int();
    const type = flags & 0xff;
    const levels = flags >>> 12;
    const hasAttr = (flags & (1 << 9)) !== 0;
    const hasTag = (flags & (1 << 10)) !== 0;
    switch (type) {
      case NILVALUE_SXP:
      case EMPTYENV_SXP:
      case BASEENV_SXP:
      case GLOBALENV_SXP:
      case UNBOUNDVALUE_SXP:
      case MISSINGARG_SXP:
      case BASENAMESPACE_SXP:
        return NIL;
      case REFSXP: {
        let i = flags >> 8;
        if (i === 0) i = this.int();
        return this.refs[i - 1] ?? NIL;
      }
      case PERSISTSXP: {
        const o: RObj = { type: STRSXP, data: this.stringVec() };
        this.refs.push(o);
        return o;
      }
      case SYMSXP: {
        const o: RObj = { type: SYMSXP, name: this.item().name ?? '' };
        this.refs.push(o);
        return o;
      }
      case PACKAGESXP:
      case NAMESPACESXP: {
        const o: RObj = { type, data: this.stringVec() };
        this.refs.push(o);
        return o;
      }
      case ENVSXP: {
        const o: RObj = { type: ENVSXP };
        this.refs.push(o);
        this.int(); // locked
        this.item(); // enclosure
        this.item(); // frame
        this.item(); // hash table
        this.item(); // attributes
        return o;
      }
      case LISTSXP:
      case LANGSXP:
      case CLOSXP:
      case PROMSXP:
      case DOTSXP:
      case ATTRLANGSXP:
      case ATTRLISTSXP: {
        // A pairlist: walk the CDR chain iteratively.
        const pairs: RObj['pairs'] = [];
        let attrs: Map<string, RObj> | undefined;
        let a = hasAttr;
        let t = hasTag;
        for (;;) {
          if (a) {
            const at = this.attributes();
            attrs ??= at;
          }
          const tag = t ? this.item().name ?? null : null;
          const value = this.item();
          pairs.push({ tag, value });
          const next = this.int();
          const nt = next & 0xff;
          if (nt === NILVALUE_SXP) break;
          if (![LISTSXP, LANGSXP, CLOSXP, PROMSXP, DOTSXP, ATTRLANGSXP, ATTRLISTSXP].includes(nt)) {
            this.p -= 4;
            this.item(); // a non-pairlist CDR: read and drop
            break;
          }
          a = (next & (1 << 9)) !== 0;
          t = (next & (1 << 10)) !== 0;
        }
        return { type: LISTSXP, pairs, attrs };
      }
      case CHARSXP: {
        const n = this.int();
        if (n === -1) return { type: CHARSXP, name: undefined };
        const bytes = this.u8.subarray(this.p, this.p + n);
        this.p += n;
        const latin1 = (levels & (1 << 2)) !== 0;
        return { type: CHARSXP, name: (latin1 ? decoder('windows-1252') : this.enc).decode(bytes) };
      }
      case LGLSXP:
      case INTSXP: {
        const n = this.length();
        const data: Array<number | null> = new Array(n);
        for (let i = 0; i < n; i++) {
          const v = this.int();
          data[i] = v === NA_INT ? null : v;
        }
        return this.withAttrs({ type, data }, hasAttr);
      }
      case REALSXP: {
        const n = this.length();
        const data: Array<number | null> = new Array(n);
        for (let i = 0; i < n; i++) {
          const v = this.double();
          data[i] = Number.isNaN(v) ? null : v;
        }
        return this.withAttrs({ type, data }, hasAttr);
      }
      case CPLXSXP: {
        const n = this.length();
        const data: Array<number | null> = new Array(n);
        for (let i = 0; i < n; i++) {
          const re = this.double();
          this.double();
          data[i] = Number.isNaN(re) ? null : re;
        }
        return this.withAttrs({ type: REALSXP, data }, hasAttr);
      }
      case RAWSXP: {
        const n = this.length();
        const data = Array.from(this.u8.subarray(this.p, this.p + n));
        this.p += n;
        return this.withAttrs({ type: INTSXP, data }, hasAttr);
      }
      case STRSXP: {
        const n = this.length();
        const data: Array<string | null> = new Array(n);
        for (let i = 0; i < n; i++) data[i] = this.item().name ?? null;
        return this.withAttrs({ type, data }, hasAttr);
      }
      case VECSXP:
      case EXPRSXP: {
        const n = this.length();
        const data: RObj[] = new Array(n);
        for (let i = 0; i < n; i++) data[i] = this.item();
        return this.withAttrs({ type: VECSXP, data }, hasAttr);
      }
      case S4SXP:
        return this.withAttrs({ type: S4SXP }, hasAttr);
      case ALTREP_SXP: {
        const info = this.item();
        const state = this.item();
        const attr = this.item();
        const o = altrep(info, state);
        if (attr.pairs) o.attrs = pairsToMap(attr);
        return o;
      }
      case SPECIALSXP:
      case BUILTINSXP: {
        const n = this.int();
        this.p += n;
        return NIL;
      }
      case BCODESXP:
      case EXTPTRSXP:
      case WEAKREFSXP:
        throw new Error('This R file holds compiled code or external pointers, not just data. Save the data frame on its own with saveRDS(df, "file.rds").');
      default:
        throw new Error(`Unknown R object type ${type} in this file.`);
    }
  }
  /** A bare list of strings (used by namespace and package references): 0, length, then CHARSXPs. */
  private stringVec(): Array<string | null> {
    this.int();
    const n = this.int();
    const out: Array<string | null> = [];
    for (let i = 0; i < n; i++) out.push(this.item().name ?? null);
    return out;
  }
  private attributes(): Map<string, RObj> {
    return pairsToMap(this.item());
  }
  private withAttrs(o: RObj, hasAttr: boolean): RObj {
    if (hasAttr) o.attrs = this.attributes();
    return o;
  }
}

function pairsToMap(pl: RObj): Map<string, RObj> {
  const m = new Map<string, RObj>();
  for (const p of pl.pairs ?? []) if (p.tag) m.set(p.tag, p.value);
  return m;
}

/** ALTREP objects R writes in compact form: integer/real sequences, deferred strings, wrappers. */
function altrep(info: RObj, state: RObj): RObj {
  const cls = info.pairs?.[0]?.value.name ?? '';
  if (cls === 'compact_intseq' || cls === 'compact_realseq') {
    const [n = 0, start = 1, step = 1] = (state.data as number[] | undefined) ?? [];
    const data = Array.from({ length: n }, (_, i) => start + i * step);
    return { type: cls === 'compact_intseq' ? INTSXP : REALSXP, data };
  }
  if (cls === 'deferred_string') {
    const arg = state.pairs?.[0]?.value;
    const data = ((arg?.data as Array<number | null>) ?? []).map((v) => (v == null ? null : numText(v)));
    return { type: STRSXP, data };
  }
  if (cls.startsWith('wrap_')) {
    const inner = (state.data as RObj[] | undefined)?.[0];
    if (inner) return inner;
  }
  throw new Error(`This R file uses a compact storage type (${cls}) this reader doesn't know. Re-save it with saveRDS(df, "file.rds", version = 2).`);
}

const classes = (o: RObj) => ((o.attrs?.get('class')?.data as string[] | undefined) ?? []);
const attrStrings = (o: RObj, name: string) => (o.attrs?.get(name)?.data as Array<string | null> | undefined) ?? [];

function isDataFrame(o: RObj) {
  return o.type === VECSXP && classes(o).includes('data.frame');
}

/** Wall-clock ISO time for seconds since 1970 in an R time zone ("" = local in R; treated as UTC). */
function isoInZone(sec: number, tz: string): string {
  if (!tz || tz === 'UTC' || tz === 'GMT') return isoFromEpochSeconds(sec, true);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(sec * 1000));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
  } catch {
    return isoFromEpochSeconds(sec, true);
  }
}

/** Factors with more levels than this are free text read in as a factor, not a set of choices. */
const MAX_FACTOR_LEVELS = 30;

function columnToStrings(col: RObj, n: number): { values: string[]; valueLabels?: ValueLabel[]; label?: string; factor?: boolean; textFactor?: boolean } {
  const cls = classes(col);
  const label = attrStrings(col, 'label')[0] ?? undefined;
  const data = (col.data ?? []) as Array<number | string | null>;
  const out = (f: (v: number | string) => string) => Array.from({ length: n }, (_, i) => (data[i] == null ? '' : f(data[i]!)));
  // Factors: a short set of levels is a choice question (codes, labelled by their levels); a long
  // one is really text read in as a factor (old read.csv defaults), so it stays text.
  if (cls.includes('factor')) {
    const levels = attrStrings(col, 'levels');
    if (levels.length > MAX_FACTOR_LEVELS) return { values: out((v) => levels[Number(v) - 1] ?? ''), label, textFactor: true };
    return { values: out((v) => String(v)), valueLabels: levels.map((l, i) => ({ value: String(i + 1), label: l ?? '' })), label, factor: true };
  }
  if (cls.includes('Date')) return { values: out((v) => isoFromEpochSeconds(Number(v) * 86400, false)), label };
  if (cls.includes('POSIXct')) {
    const tz = attrStrings(col, 'tzone')[0] ?? '';
    return { values: out((v) => isoInZone(Number(v), tz)), label };
  }
  // haven/labelled keep value labels in "labels"; foreign::read.spss in "value.labels".
  // Both are named vectors: the values, with the labels as their names.
  let valueLabels: ValueLabel[] | undefined;
  const labs = col.attrs?.get('labels') ?? col.attrs?.get('value.labels');
  if (labs?.data) {
    const names = attrStrings(labs, 'names');
    valueLabels = (labs.data as Array<number | string | null>).map((v, i) => ({ value: v == null ? '' : typeof v === 'number' ? numText(v) : v, label: names[i] ?? '' }));
  }
  if (col.type === LGLSXP) return { values: out((v) => (v ? 'TRUE' : 'FALSE')), label, valueLabels };
  if (col.type === STRSXP) return { values: out((v) => String(v)), label, valueLabels };
  if (col.type === INTSXP || col.type === REALSXP) return { values: out((v) => numText(Number(v))), label, valueLabels };
  // A list column: show each cell's first value.
  if (col.type === VECSXP) {
    const cells = (col.data ?? []) as RObj[];
    return { values: Array.from({ length: n }, (_, i) => String((cells[i]?.data as unknown[] | undefined)?.[0] ?? '')), label };
  }
  return { values: Array.from({ length: n }, () => ''), label };
}

function dataFrameToFile(df: RObj, format: string, notes: string[]): StatFile {
  const cols = (df.data ?? []) as RObj[];
  const names = attrStrings(df, 'names').map((nm, i) => nm || `column_${i + 1}`);
  const rn = df.attrs?.get('row.names');
  const rnData = (rn?.data ?? []) as Array<number | string | null>;
  // Compact row names are c(NA, -n); otherwise their length is the row count.
  const nRows = rn && rn.type === INTSXP && rnData.length === 2 && rnData[0] == null ? Math.abs(Number(rnData[1])) : rnData.length || ((cols[0]?.data as unknown[] | undefined)?.length ?? 0);
  const converted = cols.map((c) => columnToStrings(c, nRows));
  const rows = Array.from({ length: nRows }, (_, r) => converted.map((c) => c.values[r] ?? ''));
  const labels: Record<string, string> = {};
  const valueLabels: Record<string, ValueLabel[]> = {};
  converted.forEach((c, i) => {
    if (c.label) labels[names[i]!] = c.label;
    if (c.valueLabels?.length) valueLabels[names[i]!] = c.valueLabels;
  });
  // Labels kept on the data frame itself rather than on each column:
  // foreign::read.spss puts them in "variable.labels" (named by column), foreign::read.dta in
  // "var.labels" (in column order), with value labels in "label.table" + "val.labels".
  const vl = df.attrs?.get('variable.labels');
  if (vl?.data) {
    const keys = attrStrings(vl, 'names');
    (vl.data as Array<string | null>).forEach((t, i) => {
      const col = keys[i] ?? names[i];
      if (t && col && !labels[col]) labels[col] = t;
    });
  }
  const varLabels = attrStrings(df, 'var.labels');
  varLabels.forEach((t, i) => {
    if (t && names[i] && !labels[names[i]!]) labels[names[i]!] = t;
  });
  const table = df.attrs?.get('label.table');
  const sets = attrStrings(df, 'val.labels');
  if (table?.data && sets.length) {
    const setNames = attrStrings(table, 'names');
    sets.forEach((set, i) => {
      const lt = set ? (table.data as RObj[])[setNames.indexOf(set)] : undefined;
      if (!lt?.data || !names[i] || valueLabels[names[i]!]) return;
      const labelNames = attrStrings(lt, 'names');
      valueLabels[names[i]!] = (lt.data as Array<number | null>).map((v, k) => ({ value: v == null ? '' : numText(v), label: labelNames[k] ?? '' }));
    });
  }
  const factors = converted.filter((c) => c.factor).length;
  const textFactors = converted.filter((c) => c.textFactor).length;
  if (factors) notes.push(`${factors} column${factors === 1 ? ' is a factor' : 's are factors'}: read as integer codes, with the levels as response options.`);
  if (textFactors) notes.push(`${textFactors} factor column${textFactors === 1 ? ' has' : 's have'} more than ${MAX_FACTOR_LEVELS} levels, so ${textFactors === 1 ? 'it was' : 'they were'} read as text rather than as choices.`);
  return { format, columns: names, rows, labels, valueLabels, notes };
}

async function inflate(u8: Uint8Array): Promise<Uint8Array> {
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const stream = new Blob([u8.slice()]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (u8[0] === 0x42 && u8[1] === 0x5a && u8[2] === 0x68) throw new Error('This R file is bzip2-compressed, which browsers can’t open. Re-save it in R with saveRDS(df, "file.rds") (gzip, the default).');
  if (u8[0] === 0xfd && u8[1] === 0x37 && u8[2] === 0x7a) throw new Error('This R file is xz-compressed, which browsers can’t open. Re-save it in R with saveRDS(df, "file.rds") (gzip, the default).');
  return u8;
}

/** .rds, .RData or .rda. An .RData file may hold several objects; the largest data frame is read. */
export async function readRData(buf: ArrayBuffer, fileName: string): Promise<StatFile> {
  let u8 = await inflate(new Uint8Array(buf));
  const isRData = String.fromCharCode(...u8.subarray(0, 4)) === 'RDX2' || String.fromCharCode(...u8.subarray(0, 4)) === 'RDX3';
  if (isRData) u8 = u8.subarray(5);
  const r = new Reader(u8);
  r.header();
  const top = r.item();
  const notes: string[] = [];
  if (!isRData) {
    if (!isDataFrame(top)) throw new Error(`${fileName} holds an R object that isn't a data frame. Save a data frame with saveRDS(df, "${fileName}").`);
    return dataFrameToFile(top, 'R data (.rds)', notes);
  }
  const frames = (top.pairs ?? []).filter((p) => isDataFrame(p.value));
  if (!frames.length) throw new Error(`${fileName} doesn't contain a data frame.`);
  const rowsOf = (o: RObj) => ((o.data as RObj[] | undefined)?.[0]?.data as unknown[] | undefined)?.length ?? 0;
  frames.sort((a, b) => rowsOf(b.value) - rowsOf(a.value));
  if (frames.length > 1) notes.push(`The file holds ${frames.length} data frames (${frames.map((f) => f.tag).join(', ')}); "${frames[0]!.tag}" was read.`);
  else notes.push(`Read the data frame "${frames[0]!.tag}".`);
  return dataFrameToFile(frames[0]!.value, 'R data (.RData)', notes);
}
