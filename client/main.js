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
    currentTrack: null,
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

        if (this.music && this.music.isPlaying) return;

        if (!this.currentTrack) {
            const index = Math.floor(Math.random() * this.tracks.length);
            this.currentTrack = this.tracks[index];
        }

        this.music = scene.sound.add(this.currentTrack, { loop: true, volume: 0.6 });
        this.music.play();
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