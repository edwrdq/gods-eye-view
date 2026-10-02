export const LAYER = 'satellites';

export interface TleEntry {
  noradId: string;
  name: string;
  tle1: string;
  tle2: string;
  /** Epoch ms of the element set. */
  epoch: number;
}

/** Mod-10 checksum over the first 68 columns: digits count their value, '-' counts 1. */
export function tleChecksum(line: string): number {
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line.charCodeAt(i);
    if (c >= 48 && c <= 57) sum += c - 48;
    else if (c === 45) sum += 1;
  }
  return sum % 10;
}

export function validLine(line: string, n: 1 | 2): boolean {
  return line.length === 69 && line.startsWith(`${n} `) && tleChecksum(line) === line.charCodeAt(68) - 48;
}

/** Epoch from line 1 columns 19-32 (YYDDD.DDDDDDDD); two-digit years 57-99 are 19xx. */
export function tleEpoch(line1: string): number | null {
  const yy = Number(line1.slice(18, 20));
  const day = Number(line1.slice(20, 32));
  if (!Number.isInteger(yy) || !Number.isFinite(day) || day < 1 || day >= 367) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Math.round(Date.UTC(year, 0, 1) + (day - 1) * 86_400_000);
}

export interface TleParseResult {
  entries: TleEntry[];
  /** Element sets dropped for a bad length, checksum, mismatched ids or epoch. */
  invalid: number;
}

/**
 * Parse CelesTrak FORMAT=tle text (3-line sets: name, line 1, line 2), also
 * accepting 2-line sets without names. Tolerates CRLF, padded names, a leading
 * "0 " in names, blank lines and non-TLE text such as error pages (which yield
 * no entries). Element sets failing validation are skipped and counted.
 */
export function parseTle(text: string): TleParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const entries: TleEntry[] = [];
  let invalid = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i]!;
    const l2 = lines[i + 1]!;
    if (!(l1.startsWith('1 ') && l2.startsWith('2 '))) continue;
    i++;
    const epoch = tleEpoch(l1);
    const id1 = l1.slice(2, 7).trim();
    if (!validLine(l1, 1) || !validLine(l2, 2) || id1 === '' || id1 !== l2.slice(2, 7).trim() || epoch === null) {
      invalid++;
      continue;
    }
    const prev = i - 2 >= 0 ? lines[i - 2]! : '';
    const name = /^[12] \d/.test(prev) ? '' : prev.trim().replace(/^0 /, '');
    entries.push({ noradId: id1.replace(/^0+(?=\d)/, ''), name: name || `NORAD ${id1}`, tle1: l1, tle2: l2, epoch });
  }
  return { entries, invalid };
}
