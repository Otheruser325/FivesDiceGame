class LocalizationManager {
  constructor() {
    this._language = 'English';
    this._strings = {};
    this._fallbackLanguage = 'English';
    this._fallbackStrings = {};
    this._languages = [
      { id: 'English', key: 'LANG_ENGLISH', fallback: 'English' },
      { id: 'French', key: 'LANG_FRENCH', fallback: 'French' },
      { id: 'Spanish', key: 'LANG_SPANISH', fallback: 'Spanish' },
      { id: 'Italian', key: 'LANG_ITALIAN', fallback: 'Italian' },
      { id: 'Portuguese', key: 'LANG_PORTUGUESE', fallback: 'Portuguese' },
      { id: 'Welsh', key: 'LANG_WELSH', fallback: 'Welsh' }
    ];
  }

  getLanguages() {
    return this._languages.slice();
  }

  getLanguage() {
    return this._language;
  }

  getLanguageLabel(langId) {
    const entry = this._languages.find(l => l.id === langId);
    if (!entry) return langId;
    return this.t(entry.key, entry.fallback);
  }

  init(scene) {
    try {
      if (!scene || !scene.cache || !scene.cache.xml) return;
      const rawFallback = this._loadFromCache(scene, this._fallbackLanguage) || {};
      this._fallbackStrings = this._normalizeStrings(rawFallback, null);
      this._strings = this._fallbackStrings;
      this._language = this._fallbackLanguage;
    } catch (e) {}
  }

  setLanguage(scene, langId) {
    const safe = this._languages.find(l => l.id === langId)?.id || this._fallbackLanguage;
    const rawStrings = this._loadFromCache(scene, safe) || this._fallbackStrings || {};
    this._strings = this._normalizeStrings(rawStrings, this._fallbackStrings || {});
    this._language = safe;
  }

  t(key, fallback = '') {
    if (!key) return fallback || '';
    if (this._strings && Object.prototype.hasOwnProperty.call(this._strings, key)) {
      const val = this._strings[key];
      if (this._isSafeString(val)) return val;
    }
    if (this._fallbackStrings && Object.prototype.hasOwnProperty.call(this._fallbackStrings, key)) {
      const val = this._fallbackStrings[key];
      if (this._isSafeString(val)) return val;
    }
    return fallback || key;
  }

  format(keyOrText, ...args) {
    const applyFormat = (input, formatArgs) => {
      if (!formatArgs.length) return input;
      let text = input;
      formatArgs.forEach((val, idx) => {
        const safeVal = (val === null || val === undefined) ? '' : String(val);
        text = text.replace(new RegExp(`\\{${idx}\\}`, 'g'), safeVal);
        text = text.replace(new RegExp(`%${idx + 1}\\$[sd]`, 'g'), safeVal);
      });
      if (/%[sd]/.test(text)) {
        let i = 0;
        text = text.replace(/%[sd]/g, () => {
          const safeVal = (formatArgs[i] === null || formatArgs[i] === undefined) ? '' : String(formatArgs[i]);
          i += 1;
          return safeVal;
        });
      }
      return text;
    };

    let fallback = null;
    let formatArgs = Array.isArray(args) ? args.slice() : [];

    // Support calling format(key, fallback, ...args) while preserving format(key, ...args)
    if (formatArgs.length) {
      const first = formatArgs[0];
      const firstLooksLikeFallback = (typeof first === 'string') &&
        (/\{\d+\}/.test(first) || /%\d+\$[sd]/.test(first) || /%[sd]/.test(first));
      if (firstLooksLikeFallback) {
        fallback = formatArgs.shift();
      }
    }

    const base = this.t(keyOrText, fallback ?? (keyOrText || ''));
    let text = applyFormat(base, formatArgs);

    const hasNumericArg = formatArgs.some(val => {
      if (typeof val === 'number' && Number.isFinite(val)) return true;
      if (typeof val === 'string' && /\d/.test(val)) return true;
      return false;
    });

    // If placeholders are still present, try fallback language for safety.
    if ((/\{\d+\}/.test(text) || (hasNumericArg && !/\d/.test(text))) &&
        this._fallbackStrings && Object.prototype.hasOwnProperty.call(this._fallbackStrings, keyOrText)) {
      const fallbackBase = this._fallbackStrings[keyOrText] || base;
      const fallbackText = applyFormat(fallbackBase, formatArgs);
      if (!/\{\d+\}/.test(fallbackText) && (!hasNumericArg || /\d/.test(fallbackText))) {
        text = fallbackText;
      }
    }

    if (/\{\d+\}/.test(text)) {
      text = text.replace(/\{\d+\}/g, '');
    }

    return this._sanitizeText(text);
  }

  _loadFromCache(scene, langId) {
    try {
      if (!scene || !scene.cache || !scene.cache.xml) return null;
      const xml = scene.cache.xml.get(`loc:${langId}`);
      if (!xml) return null;
      return this._parseXml(xml);
    } catch (e) {
      return null;
    }
  }

  _parseXml(xmlDoc) {
    const out = {};
    try {
      const nodes = xmlDoc.getElementsByTagName('T');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const id = node.getAttribute('id');
        if (!id) continue;
        const text = node.textContent ?? '';
        out[id] = this._sanitizeText(text);
      }
    } catch (e) {}
    return out;
  }

  _sanitizeText(text) {
    if (text === null || text === undefined) return '';
    let out = String(text);
    out = out.replace(/\uFFFD/g, '');
    out = out.replace(/\uFEFF/g, '');
    out = out.replace(/\u00A0/g, ' ');
    out = out.replace(/\t/g, ' ');
    // normalize punctuation that often breaks pixel fonts
    out = out.replace(/[\u2018\u2019]/g, "'");
    out = out.replace(/[\u201C\u201D]/g, '"');
    out = out.replace(/[\u2013\u2014]/g, '-');
    out = out.replace(/\u2026/g, '...');
    out = out.replace(/\u2022/g, '-');
    return out;
  }

  _isSafeString(val) {
    if (typeof val !== 'string') return false;
    if (val.includes('\uFFFD')) return false;
    if (val.includes('??')) return false;
    return true;
  }

  _normalizeStrings(strings, fallbackStrings) {
    const out = {};
    const fallback = fallbackStrings || {};
    const hasFallback = fallback && typeof fallback === 'object';
    const placeholderRe = /\{\d+\}/g;

    for (const key of Object.keys(strings || {})) {
      let val = this._sanitizeText(strings[key]);
      if (!this._isSafeString(val) || !val.trim()) {
        val = hasFallback ? (fallback[key] || '') : val;
      }
      if (hasFallback && fallback[key]) {
        const engPh = (fallback[key].match(placeholderRe) || []).sort().join(',');
        const locPh = (val.match(placeholderRe) || []).sort().join(',');
        if (engPh !== locPh) {
          val = fallback[key];
        }
      }
      out[key] = val;
    }
    return out;
  }
}

const GlobalLocalization = new LocalizationManager();
export default GlobalLocalization;
