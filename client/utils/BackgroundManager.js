class BackgroundManager {
  static _scene = null;
  static _bg = null;
  static _opts = {};

  /**
   * Register a scene to attach the global background to.
   * opts = { key: 'bg' (asset key), width, height, padding, tint, useImageIfAvailable (true) }
   */
  static registerScene(scene, opts = {}) {
    if (!scene || !scene.add) return;
    if (BackgroundManager._scene === scene) return;

    BackgroundManager.unregisterScene();

    BackgroundManager._scene = scene;
    BackgroundManager._opts = { ...(opts || {}) };

    const cam = scene.cameras.main;
    const w = cam ? cam.width : scene.scale?.width;
    const h = cam ? cam.height : scene.scale?.height;
    const centerX = cam ? cam.centerX : (w / 2);
    const centerY = cam ? cam.centerY : (h / 2);

    const imageKey = opts.key || 'bg';
    const useImage = !!opts.useImageIfAvailable && scene.textures.exists(imageKey);

    if (useImage) {
      let frame = null;
      try {
        frame = scene.textures.getFrame(imageKey);
      } catch (e) {
        frame = null;
      }

      let src = null;
      try {
        const tex = scene.textures.get(imageKey);
        if (tex) src = tex.getSourceImage ? tex.getSourceImage() : null;
      } catch (e) {
        src = null;
      }

      const img = scene.add.image(centerX, centerY, imageKey).setOrigin(0.5).setDepth(opts.depth ?? -1000);
      const imgW = frame && frame.width ? frame.width : (src && (src.width || src.naturalWidth) ? (src.width || src.naturalWidth) : null);
      const imgH = frame && frame.height ? frame.height : (src && (src.height || src.naturalHeight) ? (src.height || src.naturalHeight) : null);

      if (imgW && imgH && w && h) {
        const scale = Math.max(w / imgW, h / imgH);
        const displayW = Math.round(imgW * scale);
        const displayH = Math.round(imgH * scale);
        img.setDisplaySize(displayW, displayH);
      } else {
        if (w && h) img.setDisplaySize(w, h);
        console.warn('[BackgroundManager] could not read texture natural size reliably — using setDisplaySize(canvasW,canvasH).', { imageKey, frame, src });
      }

      if (opts.tint) {
        try { img.setTint(opts.tint); } catch (e) {}
      }

      try { img.setScrollFactor(0); } catch (e) {}
      BackgroundManager._bg = img;
    } else {
      const pad = (typeof opts.padding === 'number') ? opts.padding : 28;
      const panelW = opts.width || Math.max(800, (w ? w : 800) - (pad * 2));
      const panelH = opts.height || Math.max(640, (h ? h : 640) - (pad * 2));

      const outer = scene.add.rectangle(centerX, centerY, panelW + 16, panelH + 16, 0x0f0f0f)
        .setStrokeStyle(2, 0x1b1b1b)
        .setDepth(opts.depth ?? -1000);
      const panel = scene.add.rectangle(centerX, centerY, panelW, panelH, 0x222222).setDepth((opts.depth ?? -1000) + 1);

      const container = scene.add.container(0, 0, [outer, panel]);
      container.setDepth(opts.depth ?? -1000);

      try {
        container.list.forEach(c => c.setScrollFactor?.(0));
      } catch (e) {}

      BackgroundManager._bg = container;
    }

    try {
      if (BackgroundManager._bg && BackgroundManager._bg.setScrollFactor) BackgroundManager._bg.setScrollFactor(0);
      if (BackgroundManager._bg && BackgroundManager._bg.list) {
        BackgroundManager._bg.list.forEach(c => c.setScrollFactor?.(0));
      }
    } catch (e) {}

    if (scene.events && typeof scene.events.once === 'function') {
      scene.events.once('shutdown', () => BackgroundManager.unregisterScene(scene));
      scene.events.once('destroy', () => BackgroundManager.unregisterScene(scene));
    }
  }

  static unregisterScene(scene = null) {
    if (scene && BackgroundManager._scene !== scene) return;
    try {
      if (BackgroundManager._bg) {
        if (BackgroundManager._bg.destroy) BackgroundManager._bg.destroy(true);
        BackgroundManager._bg = null;
      }
    } catch (e) {
      console.warn('[BackgroundManager] cleanup error', e);
    }
    BackgroundManager._scene = null;
    BackgroundManager._opts = {};
  }

  // Backwards compatible
  static createBackgroundPanel(scene, opts = {}) {
    BackgroundManager.registerScene(scene, { ...opts, useImageIfAvailable: !!opts.useImageIfAvailable });
    if (!BackgroundManager._bg) return { outer: null, panel: null };
    if (BackgroundManager._bg.list) {
      const outer = BackgroundManager._bg.list[0] || null;
      const panel = BackgroundManager._bg.list[1] || null;
      return { outer, panel };
    } else {
      return { outer: null, panel: BackgroundManager._bg };
    }
  }
}

const GlobalBackground = BackgroundManager;
export default GlobalBackground;