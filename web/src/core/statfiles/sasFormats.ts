// Which SAS formats mean a number is a date (days since 1960-01-01) or a date-time (seconds since then).

const DATETIME = /^(DATETIME|DTDATE|DTMONYY|DTWKDATX|DTYEAR|E8601DT|E8601DX|E8601DZ|B8601DT|B8601DX|B8601DZ|IS8601DT|IS8601DZ|MDYAMPM|NLDATM|DATEAMPM)/;
const DATE = /^(DATE|DAY|DDMMYY|DOWNAME|E8601DA|B8601DA|IS8601DA|JULDAY|JULIAN|MMDDYY|MMYY|MONNAME|MONTH|MONYY|NENGO|NLDATE|QTR|WEEKDATE|WEEKDATX|WEEKDAY|WORDDATE|WORDDATX|YEAR|YYMM|YYMMDD|YYMON|YYQ|MINGUO|EURDF)/;

export function sasDateKind(format: string): 'date' | 'datetime' | null {
  const f = format.toUpperCase().replace(/[\d.]+$/, '');
  if (!f) return null;
  if (DATETIME.test(f)) return 'datetime';
  if (DATE.test(f)) return 'date';
  return null;
}
