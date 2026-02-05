const DEFAULTS = {
  audio: true,            // SFX on/off
  music: true,            // Music on/off
  visualEffects: true,    // combo FX / overlays
  shuffleTrack: false,    // shuffle music tracks
  trackIndex: 0,          // which music track
  language: 'English'     // localisation language
};

class SettingsManager {
  constructor(storageKey = 'protodice_settings') {
    this.storageKey = storageKey;
  }

  // Read from registry if present, otherwise load from localStorage and merge defaults.
  get(scene) {
    if (!scene || !scene.registry) {
      // defensive: return defaults if no scene available
      return { ...DEFAULTS };
    }

    let settings = scene.registry.get('settings');
    if (!settings) {
      settings = this._loadFromLocal() || {};
      // shallow-merge defaults
      settings = { ...DEFAULTS, ...settings };
      scene.registry.set('settings', settings);
    } else {
      // ensure any missing keys from defaults exist (migrate safely)
      settings = { ...DEFAULTS, ...settings };
      scene.registry.set('settings', settings);
    }
    return settings;
  }

  // Force reload from localStorage into registry (useful at boot)
  loadInto(scene) {
    if (!scene || !scene.registry) return this.get(scene);
    const ls = this._loadFromLocal();
    const settings = { ...DEFAULTS, ...(ls || {}) };
    scene.registry.set('settings', settings);
    return settings;
  }

  // Persist registry -> localStorage
  save(scene) {
    if (!scene || !scene.registry) return;
    const settings = scene.registry.get('settings') || { ...DEFAULTS };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(settings));
    } catch (e) {
      console.warn('[SettingsManager] failed to save settings to localStorage', e);
    }
  }

  // Convenience to set single key and persist
  set(scene, key, value, { save = true } = {}) {
    if (!scene || !scene.registry) return;
    const settings = this.get(scene);
    settings[key] = value;
    scene.registry.set('settings', settings);
    if (save) this.save(scene);
    return settings;
  }

  toggle(scene, key, { save = true } = {}) {
    const settings = this.get(scene);
    settings[key] = !settings[key];
    scene.registry.set('settings', settings);
    if (save) this.save(scene);
    return settings[key];
  }

  // Helper for track index clamped
  setTrackIndex(scene, idx, { save = true, trackCount = 3 } = {}) {
    const safe = ((typeof idx === 'number' && isFinite(idx)) ? Math.floor(idx) : 0) % Math.max(1, trackCount);
    this.set(scene, 'trackIndex', safe, { save });
    return safe;
  }

  // internal
  _loadFromLocal() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[SettingsManager] failed to parse settings from localStorage', e);
      return null;
    }
  }
}

const GlobalSettings = new SettingsManager();
export default GlobalSettings;
