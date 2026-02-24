class FontManager {
  static _loaded = new Set();
  static perFontTimeout = 1000;

  /**
   * defs: [{ family, url, weight }]
   * options: { timeout } optional per-call override (ms)
   */
  static async init(defs = [], options = {}) {
    if (!Array.isArray(defs) || defs.length === 0) return;
    const timeout = options.timeout ?? FontManager.perFontTimeout;

    const tasks = defs.map(def => FontManager._loadFont(def, timeout));
    await Promise.all(tasks);
  }

  static isLoaded(family, weight = '400') {
    return FontManager._loaded.has(`${family}::${weight}`);
  }

  // ---------- internals ----------
  static async _loadFont(def = {}, timeoutMs = 1000) {
    const family = def.family || 'Unknown';
    const weight = String(def.weight || '400');
    const cacheKey = `${family}::${weight}`;
    if (FontManager._loaded.has(cacheKey)) return true;

    const fontFaceOk = await FontManager._loadWithFontFace(def, timeoutMs);
    if (fontFaceOk) {
      try { await FontManager._waitForDocumentFontsLoad(def, timeoutMs); } catch (e) {}
      FontManager._loaded.add(cacheKey);
      return true;
    }

    try {
      FontManager._injectCSSFallback(def);
      await FontManager._waitForDocumentFontsLoad(def, timeoutMs);
    } catch (e) {
      console.warn('[FontManager] fallback wait failed for', def, e);
    }

    FontManager._loaded.add(cacheKey);
    return true;
  }

  static _loadWithFontFace(def = {}, timeoutMs = 1000) {
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

  static _injectCSSFallback(def = {}) {
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

  static _waitForDocumentFontsLoad(def = {}, timeoutMs = 1000) {
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

export const GlobalFonts = FontManager;
export default GlobalFonts;
