/**
 * Utility to format numbers:
 * - compact: 1.2K, 3.456M etc (default)
 * - scientific: 1.23e+45
 * - engineering: exponent multiple of 3 (e.g. 12.3e+6)
 *
 * Accepts Number, BigInt, or numeric string.
 */

function _toBigIntString(n) {
  if (typeof n === 'bigint') {
    if (n < 0n) return { sign: '-', digits: (-n).toString() };
    return { sign: '', digits: n.toString() };
  }
  if (typeof n === 'string') {
    const s = n.trim();
    if (/^[+-]?\d+$/.test(s)) {
      if (s.startsWith('-')) return { sign: '-', digits: s.slice(1) };
      if (s.startsWith('+')) return { sign: '', digits: s.slice(1) };
      return { sign: '', digits: s };
    }
  }
  // fallback for numbers: convert via BigInt if safe length, else fallback to Number formatting
  if (typeof n === 'number') {
    if (!Number.isFinite(n)) return { sign: '', digits: '0' };
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs <= Number.MAX_SAFE_INTEGER && Math.floor(abs) === abs) {
      return { sign, digits: String(Math.floor(abs)) };
    }
    // otherwise use toFixed with a few decimals then strip decimal point for magnitude estimate
    const str = abs.toExponential(0);
    return { sign, digits: String(Math.floor(abs)) };
  }
  return { sign: '', digits: '0' };
}

export function formatCompact(value, opts = {}) {
  const digits = typeof opts.digits === 'number' ? opts.digits : 3;
  const mode = opts.mode || 'compact';

  // numeric string or BigInt path for very large numbers
  if (typeof value === 'bigint' || (typeof value === 'string' && /^[+-]?\d+$/.test(value))) {
    const { sign, digits: ds } = _toBigIntString(value);
    const len = ds.length;
    if (len <= 3) return (sign + ds);
    const groups = Math.floor((len - 1) / 3);
    const suffixes = ['', 'K', 'M', 'B', 'T', 'Q', 'q', 's', 'S', 'O', 'N', 'D'];
    const suffix = suffixes[groups] || `e${groups * 3}`;
    const leadingCount = len - groups * 3;
    const leading = ds.slice(0, leadingCount);
    const rest = ds.slice(leadingCount, Math.min(leadingCount + Math.max(0, digits - 1), ds.length));
    let mantissa = leading;
    if (rest.length > 0) {
      mantissa += '.' + rest.slice(0, Math.max(0, digits - 1));
    }
    return sign + mantissa + suffix;
  }

  // Number or other: use numeric path
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';

  if (mode === 'scientific') {
    return n.toExponential(digits - 1);
  }

  if (mode === 'engineering') {
    if (n === 0) return '0';
    const sign = n < 0 ? '-' : '';
    let abs = Math.abs(n);
    const exp = Math.floor(Math.log10(abs));
    const engExp = Math.floor(exp / 3) * 3;
    const mant = abs / Math.pow(10, engExp);
    const mantStr = mant.toFixed(Math.max(0, digits - 1)).replace(/\.?0+$/, '');
    return `${sign}${mantStr}e${engExp}`;
  }

  // compact default
  const abs = Math.abs(n);
  if (abs < 1000) return n.toString();
  const units = [
    { v: 1e33, s: 'D' },
    { v: 1e30, s: 'N' },
    { v: 1e27, s: 'O' },
    { v: 1e24, s: 'Sp' },
    { v: 1e21, s: 'Sx' },
    { v: 1e18, s: 'Qi' },
    { v: 1e15, s: 'Qa' },
    { v: 1e12, s: 'T' },
    { v: 1e9, s: 'B' },
    { v: 1e6, s: 'M' },
    { v: 1e3, s: 'K' }
  ];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (abs >= u.v) {
      const val = n / u.v;
      const s = val.toFixed(Math.max(0, digits - 1)).replace(/\.?0+$/, '');
      return s + u.s;
    }
  }
  return n.toString();
}

export function formatFull(value, opts = {}) {
  const mode = opts.mode || 'full';
  const digits = typeof opts.digits === 'number' ? opts.digits : 3;

  if (mode === 'scientific') return formatCompact(value, { digits, mode: 'scientific' });
  if (mode === 'engineering') return formatCompact(value, { digits, mode: 'engineering' });

  // full spelled-out, but handle BigInt/string
  if (typeof value === 'bigint' || (typeof value === 'string' && /^[+-]?\d+$/.test(value))) {
    const { sign, digits: ds } = _toBigIntString(value);
    const len = ds.length;
    if (len < 4) return sign + ds;
    const units = [
      { threshold: 1e33, suffix: ' Decillion' },
      { threshold: 1e30, suffix: ' Nonillion' },
      { threshold: 1e27, suffix: ' Octillion' },
      { threshold: 1e24, suffix: ' Septillion' },
      { threshold: 1e21, suffix: ' Sextillion' },
      { threshold: 1e18, suffix: ' Quintillion' },
      { threshold: 1e15, suffix: ' Quadrillion' },
      { threshold: 1e12, suffix: ' Trillion' },
      { threshold: 1e9, suffix: ' Billion' },
      { threshold: 1e6, suffix: ' Million' },
      { threshold: 1e3, suffix: ' Thousand' }
    ];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const tStr = String(u.threshold);
      if (ds.length >= tStr.length) {
        const group = Math.floor((ds.length - 1) / 3);
        const leadingCount = ds.length - group * 3;
        const lead = ds.slice(0, leadingCount);
        const frac = ds.slice(leadingCount, leadingCount + 2);
        const display = frac.length ? `${lead}.${frac}` : `${lead}`;
        const suffix = units[units.length - 1 - i]?.suffix || '';
        return sign + display + suffix;
      }
    }
    return sign + ds;
  }

  // numeric fallback for normal numbers
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs < 1000) return n.toString();
  const compact = formatCompact(n, { digits: 3, mode: 'compact' });
  return compact
    .replace('K', ' Thousand')
    .replace('M', ' Million')
    .replace('B', ' Billion')
    .replace('T', ' Trillion')
    .replace('Q', ' Quadrillion');
}