// Helpers shared by the OAuth callback redirect and the session cookie policy.
// Both take values that arrive from the browser, so they validate rather than
// trust them.

// A client may ask to be returned to the page it started from (for example a
// GitHub Pages project path). Only a same-origin path is accepted: no scheme,
// host, query, fragment, traversal or control characters.
export function sanitizeClientPath(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 300) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('\\') || value.includes('..')) return null;
  if (/[\u0000-\u001f\u007f?#]/.test(value)) return null;
  return value;
}

function hostnameOf(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch (e) {
    return null;
  }
}

// Deliberately a heuristic: the last two labels approximate the registrable
// domain without pulling in a public-suffix list. It is only used to choose
// between SameSite=Lax and SameSite=None for the same host, so a wrong answer
// costs compatibility, not confidentiality.
function siteHint(hostname) {
  if (!hostname) return null;
  if (hostname === 'localhost' || /^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    return hostname;
  }
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}

// Builds the same-origin return URL, dropping any path that tries to leave the
// allowed origin. Returns null when the origin itself is unusable.
export function resolveClientRedirect(origin, clientPath) {
  try {
    const base = new URL(origin);
    const path = sanitizeClientPath(clientPath);
    if (!path) return base.toString();
    const target = new URL(path, base);
    if (target.origin !== base.origin) return base.toString();
    return target.toString();
  } catch (e) {
    return null;
  }
}

export function isSameSiteOrigin(clientOrigin, apiHostOrOrigin) {
  const clientHost = hostnameOf(clientOrigin);
  const apiHost = hostnameOf(apiHostOrOrigin);
  if (!clientHost || !apiHost) return false;
  if (clientHost === apiHost) return true;
  return siteHint(clientHost) === siteHint(apiHost);
}
