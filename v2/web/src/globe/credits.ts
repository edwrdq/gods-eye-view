import type { Credit } from './types.ts';

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

function safeUrl(raw: string | null, allowData: boolean): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, location.href);
    if (SAFE_PROTOCOLS.has(u.protocol) || (allowData && u.protocol === 'data:')) return u.href;
  } catch {
    /* fall through */
  }
  return null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rebuild a credit node keeping only text, http(s) links and images. */
function sanitize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent ?? '');
  if (!(node instanceof HTMLElement)) return '';
  const inner = Array.from(node.childNodes).map(sanitize).join('');
  const tag = node.tagName.toLowerCase();
  if (tag === 'a') {
    const href = safeUrl(node.getAttribute('href'), false);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
  }
  if (tag === 'img') {
    const src = safeUrl(node.getAttribute('src'), true);
    return src ? `<img src="${esc(src)}" alt="${esc(node.getAttribute('alt') ?? node.getAttribute('title') ?? '')}">` : '';
  }
  return inner;
}

/**
 * Cesium renders credits into DOM it owns. Instead of loading widgets.css and
 * showing Cesium's own lightbox, we keep that DOM hidden and read it back.
 */
export function readCredits(...roots: ParentNode[]): Credit[] {
  const seen = new Set<string>();
  const out: Credit[] = [];
  const push = (el: Element) => {
    const html = sanitize(el).trim();
    if (!html || seen.has(html)) return;
    seen.add(html);
    out.push({ html });
  };
  for (const root of roots) {
    root.querySelectorAll('.cesium-credit-logoContainer > *, .cesium-credit-textContainer > *:not(.cesium-credit-expand-link), .cesium-credit-lightbox li').forEach(push);
  }
  return out;
}
