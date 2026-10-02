/** URL checks for addresses that come from third-party data. */

const CONTROL = /[\u0000-\u001f\u007f]/;

/** An http(s) URL without credentials, normalised; undefined for anything else (javascript:, data:, relative, garbage). */
export function httpUrl(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (v === '' || v.length > max || CONTROL.test(v)) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}

const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|192\.0\.0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/;

/**
 * True when the server may fetch this URL: https, no credentials, and a host
 * name (not an IP literal, localhost or an internal suffix). Operator feeds name
 * their own follow-up URLs, so this keeps a bad entry from pointing the server
 * at its own network. DNS answers are not re-checked.
 */
export function isPublicHttpsUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  if (host.includes(':') || host.startsWith('[')) return false; // IPv6 literal
  if (/^[\d.]+$/.test(host)) return false; // IPv4 literal (also catches PRIVATE_V4)
  if (PRIVATE_V4.test(host)) return false;
  return host.includes('.');
}
