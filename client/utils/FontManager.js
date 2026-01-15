class FontManager {
  constructor({ perFontTimeout = 1000 } = {}) {
    this._loaded = new Set();
    this.perFontTimeout = perFontTimeout;
  }

  /**
   * defs: [{ family, url, weight }]
   * options: { timeout } optional per-call override (ms)
   */
  async init(defs = [], options = {}) {
    if (!Array.isArray(defs) || defs.length === 0) return;
    const timeout = options.timeout ?? this.perFontTimeout;

    const tasks = defs.map(def => this._loadFont(def, timeout));
    await Promise.all(tasks);
  }

  isLoaded(family, weight = '400') {
    return this._loaded.has(`${family}::${weight}`);
  }

  // ---------- internals ----------
  async _loadFont(def = {}, timeoutMs = 1000) {
    const family = def.family || 'Unknown';
    const weight = String(def.weight || '400');
    const cacheKey = `${family}::${weight}`;
    if (this._loaded.has(cacheKey)) return true;

    const fontFaceOk = await this._loadWithFontFace(def, timeoutMs);
    if (fontFaceOk) {
      try { await this._waitForDocumentFontsLoad(def, timeoutMs); } catch (e) {}
      this._loaded.add(cacheKey);
      return true;
    }

    try {
      this._injectCSSFallback(def);
      await this._waitForDocumentFontsLoad(def, timeoutMs);
    } catch (e) {
      console.warn('[FontManager] fallback wait failed for', def, e);
    }

    this._loaded.add(cacheKey);
    return true;
  }

  _loadWithFontFace(def = {}, timeoutMs = 1000) {
    return new Promise(resolve => {
      if (typeof FontFace === 'undefined') return resolve(false);

      try {
        const family = def.family || 'Unknown';
        const weight = String(def.weight || '400');
        const src = `url(${def.url})`;
        const ff = new FontFace(family, src, { weight, style: 'normal' });

        const loadPromise = ff.load()
          .then(loaded => {
            try { document.fonts.add(loaded); } catch (e) {}
            return true;
          })
          .catch(err => {
            console.warn('[FontManager] FontFace.load rejected for', def, err);
            return false;
          });

        const timer = new Promise(res => setTimeout(() => res(false), timeoutMs));
        Promise.race([loadPromise, timer]).then(ok => resolve(Boolean(ok)));
      } catch (e) {
        console.warn('[FontManager] _loadWithFontFace failed for', def, e);
        resolve(false);
      }
    });
  }

  _injectCSSFallback(def = {}) {
    try {
      const cssFamily = (def.family || 'Unknown').replace(/["']/g, '');
      const weight = def.weight || '400';
      const url = def.url || '';
      const styleEl = document.createElement('style');
      styleEl.type = 'text/css';
      styleEl.innerHTML = `
        @font-face {
          font-family: '${cssFamily}';
          src: url('${url}') format('truetype');
          font-weight: ${weight};
          font-style: normal;
          font-display: swap;
        }
      `;
      document.head.appendChild(styleEl);
      return true;
    } catch (e) {
      console.warn('[FontManager] injectCSSFallback failed for', def, e);
      return false;
    }
  }

  _waitForDocumentFontsLoad(def = {}, timeoutMs = 1000) {
    return new Promise(resolve => {
      try {
        if (!document.fonts || typeof document.fonts.load !== 'function') {
          return resolve();
        }

        const test = `${def.weight || '400'} 16px "${def.family || ''}"`;
        const timer = setTimeout(() => resolve(), timeoutMs);

        document.fonts.load(test).then(() => {
          clearTimeout(timer);
          resolve();
        }).catch(() => {
          clearTimeout(timer);
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }
}

export const GlobalFonts = new FontManager({ perFontTimeout: 1000 });
export default GlobalFonts;