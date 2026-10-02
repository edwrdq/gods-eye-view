export interface Segment {
  text: string;
  match: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split `text` into segments marking where words of `query` occur (case-insensitive). */
export function splitMatches(text: string, query: string): Segment[] {
  const words = query
    .trim()
    .split(/[\s,]+/)
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length);
  if (words.length === 0) return [{ text, match: false }];
  const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'gi');
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), match: false });
    out.push({ text: m[0], match: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}
