// Statistical packages' data files -> a table with variable and value labels.
import type { StatFile } from './common';
import { readDta } from './dta';
import { readSas7bdat } from './sas7bdat';
import { readSav } from './sav';
import { readXpt } from './xpt';

export type { StatFile, ValueLabel } from './common';

export const STAT_FILE_EXTENSIONS = ['.sav', '.zsav', '.sas7bdat', '.xpt', '.dta'];

export const isStatFile = (fileName: string) => STAT_FILE_EXTENSIONS.some((e) => fileName.toLowerCase().endsWith(e));

/** Read an SPSS, SAS or Stata data file, chosen by its extension. */
export async function readStatFile(fileName: string, buf: ArrayBuffer): Promise<StatFile> {
  const name = fileName.toLowerCase();
  if (name.endsWith('.sav') || name.endsWith('.zsav')) return readSav(buf);
  if (name.endsWith('.sas7bdat')) return readSas7bdat(buf);
  if (name.endsWith('.xpt')) return readXpt(buf);
  if (name.endsWith('.dta')) return readDta(buf);
  throw new Error(`${fileName} isn't an SPSS, SAS or Stata data file.`);
}
