export const GlobalAudio = {
    music: null,
    currentTrack: 0,
    tracks: ['hero_time', 'energy', 'powerhouse'],
    jukeboxEnabled: false,

    getSettings(scene) {
        let settings = scene.registry.get('settings');
        if (!settings) {
            settings = {
                audio: true,
                music: true,
                visualEffects: true,
                trackIndex: 0
            };
            scene.registry.set('settings', settings);
        }
        return settings;
    },
	
	saveSettings(scene) {
        const settings = scene.registry.get('settings');
        localStorage.setItem('fives_settings', JSON.stringify(settings));
    },

    // ------------ CORE MUSIC PLAYBACK ------------
    playMusic(scene) {
        const settings = this.getSettings(scene);
        if (!settings.music) return;

        // Track sync with settings
        this.currentTrack = settings.trackIndex;

        // Already playing correct track? Do nothing
        if (this.music && this.music.isPlaying) return;

        const trackKey = this.tracks[this.currentTrack];
		
		// Failsafe: prevent crash if index invalid
        if (!trackKey) {
            console.warn('Invalid trackIndex:', this.currentTrack);
            this.currentTrack = 0;
            settings.trackIndex = 0;
            scene.registry.set('settings', settings);
            this.saveSettings(scene);
            return;
        }

        this.music = scene.sound.add(trackKey, { volume: 0.6 });

        // If not in jukebox mode, enable automatic cycling
        if (!this.jukeboxEnabled) {
            this.music.once('complete', () => {
                this.nextTrack(scene, true);
            });
        }

        this.music.play();
    },

    // ------------ MANUAL TRACK SELECTOR ------------
    setTrack(scene, index) {
        const settings = this.getSettings(scene);

        // Clamp and store
        this.currentTrack = index % this.tracks.length;
        settings.trackIndex = this.currentTrack;
        scene.registry.set('settings', settings);

        // Force Jukebox ON (no auto cycle)
        this.jukeboxEnabled = true;

        // If music is ON, switch track immediately
        if (settings.music) {
            if (this.music) {
                this.music.stop();
                this.music = null;
            }
            this.playMusic(scene);
        }
    },

    // ------------ AUTO-CYCLE NEXT TRACK ------------
    nextTrack(scene, auto = false) {
        const settings = this.getSettings(scene);

        // Auto skip if jukebox is enabled
        if (this.jukeboxEnabled && auto) return;

        if (this.music) {
            this.music.stop();
            this.music = null;
        }

        this.currentTrack = (this.currentTrack + 1) % this.tracks.length;
        settings.trackIndex = this.currentTrack;
        scene.registry.set('settings', settings);

        this.playMusic(scene);
    },

    // ------------ MUSIC TOGGLE ------------
    toggleMusic(scene) {
        const settings = this.getSettings(scene);
        settings.music = !settings.music;
        scene.registry.set('settings', settings);

        if (settings.music) {
            this.playMusic(scene);
        } else {
            this.stopMusic();
        }
    },

    stopMusic() {
        if (this.music) {
            this.music.stop();
            this.music = null;
        }
    },

    // ------------ SFX ------------
    playButton(scene) {
        const settings = this.getSettings(scene);
        if (!settings.audio) return;
        scene.sound.play('button', { volume: 0.5 });
    },

    playDice(scene) {
        const settings = this.getSettings(scene);
        if (!settings.audio) return;
        scene.sound.play('dice', { volume: 0.5 });
    },
	
	comboSFX(scene, comboName) {
        if (!scene.sound) return;

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
            scene.sound.play(key, { volume: 0.6 });
        }
    }
};