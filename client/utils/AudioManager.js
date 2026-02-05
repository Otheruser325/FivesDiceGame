import GlobalSettings from './SettingsManager.js';

class AudioManager {
  constructor() {
    this.music = null,
    this.currentTrack = 0,
    this.tracks = ['dice_league', 'basilisk_theme', 'powerhouse'],
    this.jukeboxEnabled = false
    this._onCompleteRef = null;
    this._lastTrackKey = null;
    this._attachedSoundManager = null;

    // Autoplay fallback handlers
    this._onUserGestureAutoplay = null;
    this._onVisibilityChange = null;
  }

  // Backwards-compatible method — now uses Settings manager
  getSettings(scene) {
    return GlobalSettings.get(scene);
  }

  saveSettings(scene) {
    GlobalSettings.save(scene);
  }

  _settingsOrDefault(scene) {
    return GlobalSettings.get(scene) ?? { music: true, trackIndex: 0, shuffleTrack: false };
  }

  _cleanupMusic() {
    if (!this.music) return;
    try {
      if (this.music.off && this._onCompleteRef) {
        try { this.music.off('complete', this._onCompleteRef); } catch (e) {}
      }
      this.music.stop && this.music.stop();
      this.music.destroy && this.music.destroy();
    } catch (e) {
      // swallow; defensive
    }
    this.music = null;
    this._attachedSoundManager = null;
    this._onCompleteRef = null;
  }

  // Try to attach visibility handler so we can resume AudioContext on visibilitychange
  _attachVisibilityHandler() {
    if (this._onVisibilityChange) return;
    this._onVisibilityChange = () => {
      try {
        if (document.visibilityState === 'visible') {
          // Try to resume the WebAudio context (Phaser uses WebAudio under the hood)
          if (this._attachedSoundManager && this._attachedSoundManager.context && typeof this._attachedSoundManager.context.resume === 'function') {
            this._attachedSoundManager.context.resume().catch(() => {});
          }
          // If we have a music object that isn't playing, try play (defensive)
          if (this.music && !this.music.isPlaying) {
            try { this.music.play(); } catch (e) {}
          }
        }
      } catch (e) {}
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _detachVisibilityHandler() {
    if (!this._onVisibilityChange) return;
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this._onVisibilityChange = null;
  }

  _attachUserGestureForAutoplay(scene) {
    if (this._onUserGestureAutoplay) return;

    // handler references for removal
    this._onUserGestureAutoplay = () => {
      try {
        // attempt to resume sound manager context first (Phaser uses AudioContext)
        if (scene && scene.sound && scene.sound.context && typeof scene.sound.context.resume === 'function') {
          scene.sound.context.resume().catch(() => {});
        }
        // then attempt to play the music again
        this.playMusic(scene);
      } catch (e) {}
      // remove listener after first call
      this._removeUserGestureListener();
    };

    // listen to several possible user gestures
    ['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
      window.addEventListener(evt, this._onUserGestureAutoplay, { once: true, passive: true });
    });
  }

  _removeUserGestureListener() {
    if (!this._onUserGestureAutoplay) return;
    ['pointerdown', 'touchstart', 'keydown'].forEach(evt => {
      try { window.removeEventListener(evt, this._onUserGestureAutoplay); } catch (e) {}
    });
    this._onUserGestureAutoplay = null;
  }

  // ------------ CORE MUSIC PLAYBACK ------------
  playMusic(scene) {
    if (!scene || typeof scene.sound === 'undefined') {
      console.warn('[AudioManager] playMusic called without a valid scene; skipping playback.');
      return;
    }

    const settings = this._settingsOrDefault(scene);
    if (!settings.music) return;

    // Ensure currentTrack originates from settings unless explicitly set
    const desiredIndex = Number.isFinite(settings.trackIndex) ? settings.trackIndex : 0;
    this.currentTrack = ((desiredIndex % this.tracks.length) + this.tracks.length) % this.tracks.length;
    const trackKey = this.tracks[this.currentTrack];

    if (!trackKey) {
      console.warn('[AudioManager] invalid trackKey for index', this.currentTrack);
      this.currentTrack = 0;
      GlobalSettings.set(scene, 'trackIndex', 0);
      return;
    }

    // If already playing the same track on the same sound manager, keep it
    if (this.music && this.music.isPlaying && this._lastTrackKey === trackKey && this._attachedSoundManager === scene.sound) {
      return;
    }

    // Otherwise recreate/attach the music to the provided scene's sound manager
    this._cleanupMusic();
    this._lastTrackKey = trackKey;

    try {
      // NEW: loop when shuffle is OFF (default), else do not loop and auto-advance on 'complete'
      // If shuffleTrack is false => continuous loop of current track
      // If shuffleTrack is true => pick next on complete
      const loop = !settings.shuffleTrack;

      this.music = scene.sound.add(trackKey, { volume: 0.6, loop });
      this._attachedSoundManager = scene.sound;

      // attach visibility handler to attempt resume when page becomes visible
      this._attachVisibilityHandler();

      // If not looping, set up the 'complete' handler so we auto-advance (shuffle vs sequential)
      if (!loop) {
        // no complete handler required for continuous loop
        this._onCompleteRef = null;
      } else {
        // (this branch is not expected now since loop === !shuffle; kept for safety)
        this._onCompleteRef = null;
      }

      // If we *did* choose non-looping behavior (shuffle on) then set complete handler
      if (!loop) {
        // actually we looped above -- this block is redundant by design
      } else {
        // redundant
      }

      // Instead: handle the shuffle ON case: if shuffle is true we used loop=false, so attach complete
      if (settings.shuffleTrack) {
        // ensure we are listening for completion to auto-advance
        this._onCompleteRef = () => {
          // auto true to indicate complete-fired advance
          this.nextTrack(scene, true);
        };
        // use once to avoid duplicate listeners
        this.music.once('complete', this._onCompleteRef);
      } else {
        this._onCompleteRef = null;
      }

      // Try to play - some browsers will reject this with NotAllowedError if no user gesture happened
      const playResult = this.music.play();

      // Phaser's Sound.play may not return a promise; we defensively check for a Promise-like return
      if (playResult && typeof playResult.then === 'function') {
        playResult.catch((err) => {
          console.warn('[AudioManager] autoplay blocked, will resume on user gesture.', err);
          this._attachUserGestureForAutoplay(scene);
        });
      } else {
        setTimeout(() => {
          try {
            if (this.music && !this.music.isPlaying) {
              this._attachUserGestureForAutoplay(scene);
            }
          } catch (e) {}
        }, 200);
      }
    } catch (e) {
      console.warn('[AudioManager] failed to play music:', e);
      this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
      GlobalSettings.set(scene, 'trackIndex', this.currentTrack);
      this._cleanupMusic();
      this._attachUserGestureForAutoplay(scene);
    }
  }

  // manual selection of a specific track index — respects shuffle setting:
  // if shuffleTrack enabled, selecting a track will set trackIndex but NOT force loop.
  setTrack(scene, index) {
    const trackCount = this.tracks.length;
    const clamped = ((index % trackCount) + trackCount) % trackCount;
    GlobalSettings.set(scene, 'trackIndex', clamped);
    this.currentTrack = clamped;

    // Keep jukeboxEnabled behavior (manual selection implies user intent to keep it)
    const settings = this._settingsOrDefault(scene);
    this.jukeboxEnabled = !!(!settings.shuffleTrack);

    // Recreate and play immediately (on given scene)
    this._cleanupMusic();
    this.playMusic(scene);
  }

  // If you want to go back to auto-cycling (advance tracks on complete) call this
  disableJukebox(scene) {
    this.jukeboxEnabled = false;
    if (scene) GlobalSettings.set(scene, 'trackIndex', this.currentTrack);
    this._cleanupMusic();
    if (scene) this.playMusic(scene);
  }

  // nextTrack(auto) - if auto true, called from 'complete' event; shuffle setting changes behaviour
  nextTrack(scene, auto = false) {
    const settings = this._settingsOrDefault(scene);

    // If auto-called and shuffle is OFF (looping), then do nothing (we want continuous loop)
    if (auto && !settings.shuffleTrack) {
      if (!this.music || !this.music.isPlaying) {
        this.playMusic(scene);
      }
      return;
    }

    this._cleanupMusic();

    if (settings.shuffleTrack) {
      if (this.tracks.length <= 1) {
        this.currentTrack = 0;
      } else {
        let next = this.currentTrack;
        for (let attempts = 0; attempts < 10 && next === this.currentTrack; attempts++) {
          next = Math.floor(Math.random() * this.tracks.length);
        }
        if (next === this.currentTrack) next = (this.currentTrack + 1) % this.tracks.length;
        this.currentTrack = next;
      }
    } else {
      this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
    }

    if (scene) GlobalSettings.set(scene, 'trackIndex', this.currentTrack);

    if (!settings.music) return;

    this.playMusic(scene);
  }

  toggleMusic(scene) {
    const current = GlobalSettings.toggle(scene, 'music');
    GlobalSettings.save(scene);
    if (current) this.playMusic(scene); else this.stopMusic();
    return current;
  }

  stopMusic() {
    this._cleanupMusic();
    this._removeUserGestureListener();
    this._detachVisibilityHandler();
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