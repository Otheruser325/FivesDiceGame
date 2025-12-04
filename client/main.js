import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import SettingsScene from './scenes/SettingsScene.js';
import HelpScene from './scenes/HelpScene.js';
import PlayModeScene from './scenes/PlayModeScene.js';
import LocalConfigScene from './scenes/LocalConfigScene.js';
import LocalGameScene from './scenes/LocalGameScene.js';
import LocalPostGameScene from './scenes/LocalPostGameScene.js';
import OnlineGameScene from './scenes/OnlineGameScene.js';

export const GlobalAudio = {
    music: null,
    currentTrack: 0, // Always start at the first track
    tracks: ['hero_time', 'energy', 'powerhouse'],

    getSettings(scene) {
        let settings = scene.registry.get('settings');
        if (!settings) {
            settings = { audio: true, music: true, comboRules: false };
            scene.registry.set('settings', settings);
        }
        return settings;
    },

    playMusic(scene) {
        const settings = this.getSettings(scene);
        if (!settings.music) return;

        // If music is already playing—do nothing
        if (this.music && this.music.isPlaying) return;

        // If currentTrack is out of range, reset it
        if (this.currentTrack >= this.tracks.length) {
            this.currentTrack = 0;
        }

        const trackKey = this.tracks[this.currentTrack];

        // Create audio instance without looping
        this.music = scene.sound.add(trackKey, { volume: 0.6 });

        // When the track finishes, move to the next one
        this.music.once('complete', () => {
            this.nextTrack(scene, /* auto */ true);
        });

        this.music.play();
    },

    nextTrack(scene, auto = false) {
        const settings = this.getSettings(scene);

        // If manually clicked while music is off, turn music ON
        if (!auto && !settings.music) {
            settings.music = true;
            scene.registry.set('settings', settings);
        }

        // Stop & clean previous audio instance
        if (this.music) {
            this.music.stop();
            this.music = null;
        }

        // Advance to next track
        this.currentTrack = (this.currentTrack + 1) % this.tracks.length;

        // Play the next one
        this.playMusic(scene);
    },

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

    playButton(scene) {
        const settings = this.getSettings(scene);
        if (!settings.audio) return;
        scene.sound.play('button', { volume: 0.5 });
    },

    playDice(scene) {
        const settings = this.getSettings(scene);
        if (!settings.audio) return;
        scene.sound.play('dice', { volume: 0.5 });
    }
};

const config = {
    type: Phaser.AUTO,
    width: 1200,
    height: 900,
    parent: 'game-container',
    backgroundColor: '#1f1f1f',
    scene: [
        PreloadScene,
        MenuScene,
        SettingsScene,
		HelpScene,
        PlayModeScene,
        LocalConfigScene,
        LocalGameScene,
		LocalPostGameScene,
        OnlineGameScene,
    ]
};

new Phaser.Game(config);