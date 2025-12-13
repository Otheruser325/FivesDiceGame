import GlobalSettings from './SettingsManager.js';

class AudioManager {
  constructor() {
    this.music = null,
    this.currentTrack = 0,
    this.tracks = ['hero_time', 'energy', 'powerhouse'],
    this.jukeboxEnabled = false
  }

  // Backwards-compatible method — now uses Settings manager
  getSettings(scene) {
    return GlobalSettings.get(scene);
  }

  saveSettings(scene) {
    GlobalSettings.save(scene);
  }

  // ------------ CORE MUSIC PLAYBACK ------------
  playMusic(scene) {
    // Defensive: ensure a valid Phaser Scene with sound manager was passed
    if (!scene || typeof scene.sound === 'undefined') {
      console.warn('[AudioManager] playMusic called without a valid scene; skipping playback.');
      return;
    }

    const settings = GlobalSettings.get(scene) || { music: false };
    if (!settings.music) return;

    this.currentTrack = settings.trackIndex ?? 0;

    const trackKey = this.tracks[this.currentTrack];
    if (!trackKey) {
      console.warn('Invalid trackIndex:', this.currentTrack);
      this.currentTrack = 0;
      GlobalSettings.set(scene, 'trackIndex', 0);
      return;
    }

    if (this.music && this.music.isPlaying && this.music.key === trackKey) return;

    if (this.music) {
      try { this.music.stop(); } catch (e) {}
      this.music = null;
    }

    try {
      this.music = scene.sound.add(trackKey, { volume: 0.6 });
      if (!this.jukeboxEnabled) {
        this.music.once('complete', () => this.nextTrack(scene, true));
      }
      this.music.play();
    } catch (e) {
      console.warn('[AudioManager] failed to play music:', e);
    }
  }

  setTrack(scene, index) {
    const trackCount = this.tracks.length;
    const clamped = GlobalSettings.setTrackIndex(scene, index, { trackCount });
    this.currentTrack = clamped;
    this.jukeboxEnabled = true; // manual selection implies jukebox mode

    // immediate switch if music enabled
    const settings = GlobalSettings.get(scene);
    if (settings.music) {
      if (this.music) {
        try { this.music.stop(); } catch (e) {}
        this.music = null;
      }
      this.playMusic(scene);
    }
  }

  nextTrack(scene, auto = false) {
    const settings = GlobalSettings.get(scene);
    if (this.jukeboxEnabled && auto) return; // don't auto-cycle when jukebox active

    if (this.music) {
      try { this.music.stop(); } catch (e) {}
      this.music = null;
    }

    this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
    GlobalSettings.set(scene, 'trackIndex', this.currentTrack);
    this.playMusic(scene);
  }

  toggleMusic(scene) {
    const current = GlobalSettings.toggle(scene, 'music');
    if (current) this.playMusic(scene); else this.stopMusic();
  }

  stopMusic() {
    if (this.music) {
      try { this.music.stop(); } catch (e) {}
      this.music = null;
    }
  }

  // ------------ SFX ------------
  playButton(scene) {
    const settings = GlobalSettings.get(scene);
    if (!settings.audio) return;
    try { scene.sound.play('button', { volume: 0.5 }); } catch (e) {}
  }

  playDice(scene) {
    const settings = GlobalSettings.get(scene);
    if (!settings.audio) return;
    try { scene.sound.play('dice', { volume: 0.5 }); } catch (e) {}
  }

  comboSFX(scene, comboName) {
    if (!scene || !scene.sound) return;

    const key = {
      pair: 'combo_pair',
      twoPair: 'combo_pair',
      triple: 'combo_triple',
      fullHouse: 'combo_fullHouse',
      fourOfAKind: 'combo_fourOfAKind',
      fiveOfAKind: 'combo_fiveOfAKind',
      straight: 'combo_straight'
    }[comboName];

    if (key) {
      try { scene.sound.play(key, { volume: 0.6 }); } catch (e) {}
    }
  }
};

const GlobalAudio = new AudioManager();
export default GlobalAudio;