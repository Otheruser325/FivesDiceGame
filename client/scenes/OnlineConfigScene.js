import { getSocket } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';

export default class OnlineConfigScene extends Phaser.Scene {
    constructor() {
        super('OnlineConfigScene');

        this.selectedPlayers = 2;
        this.selectedRounds = 20;
        this.comboRules = false;
    }

    init(data) {
        if (data.players) this.selectedPlayers = data.players;
        if (data.rounds) this.selectedRounds = data.rounds;
        if (typeof data.combos === "boolean") this.comboRules = data.combos;
    }

    create() {

        this.add.text(600, 60, 'Online Game Configuration', { fontSize: 40 }).setOrigin(0.5);

        // PLAYERS COUNT
        this.add.text(600, 120, 'How many players?', { fontSize: 28 }).setOrigin(0.5);

        const playerOptions = [2, 3, 4, 5, 6];
        playerOptions.forEach((num, i) => {
            const btn = this.add.text(600, 160 + i * 40, `${num}`, {
                fontSize: 26,
                color: num === this.selectedPlayers ? '#ffff66' : '#ffffff'
            })
                .setOrigin(0.5)
                .setInteractive();

            btn.on('pointerdown', () => {
                this.selectedPlayers = num;
                this.refreshScene();
            });
        });

        // ROUNDS
        this.add.text(600, 360, 'How many rounds?', {
            fontSize: 28
        }).setOrigin(0.5);

        const roundOptions = [10, 15, 20, 25, 30];
        roundOptions.forEach((r, i) => {
            const btn = this.add.text(600, 400 + i * 40, `${r} rounds`, {
                fontSize: 24,
                color: r === this.selectedRounds ? '#ffff66' : '#ffffff'
            })
                .setOrigin(0.5)
                .setInteractive();

            btn.on('pointerdown', () => {
                this.selectedRounds = r;
                this.refreshScene();
            });
        });

        // COMBO RULES
        this.add.text(600, 620, 'Additional rules:', {
            fontSize: 26
        }).setOrigin(0.5);

        this.comboBtn = this.add.text(
            600,
            660,
            `More points for combos: ${this.comboRules ? "YES" : "NO"}`,
            { fontSize: 24 }
        )
            .setOrigin(0.5)
            .setInteractive();

        this.comboBtn.on('pointerdown', () => {
            this.comboRules = !this.comboRules;
            this.refreshScene();
        });

        // CREATE LOBBY
        const startBtn = this.add.text(600, 720, 'Create Lobby!', {
            fontSize: 32, color: '#66ff66'
        }).setOrigin(0.5).setInteractive();

        startBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);

            const payload = {
                players: this.selectedPlayers,
                rounds: this.selectedRounds,
                combos: this.comboRules
            };

            const socket = getSocket();

            // resolve myId (socket first, then localStorage fallback)
            try { 
                let myId = null;
                try { myId = getSocket().data?.user?.id || getSocket().userId || null; } catch (e) { myId = null; }
                if (!myId) {
                  try {
                    const raw = localStorage.getItem('fives_user');
                    if (raw) {
                        const cached = JSON.parse(raw);
                        if (cached && cached.id) myId = cached.id;
                    }
                  } catch (e) {}
                }
                socket.emit('create-lobby', payload, myId);
                socket.once("lobby-created", code => {
                  this.scene.start("OnlineLobbyScene", { code });
                });
            } catch (e) { 
                console.warn('emit failed', e); 
            }
        });

        // BACK BUTTON
        const backBtn = this.add.text(80, 800, '← Back', {
            fontSize: 24,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        backBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.start('OnlineMenuScene');
        });
    }

    refreshScene() {
        this.scene.restart({
            players: this.selectedPlayers,
            rounds: this.selectedRounds,
            combos: this.comboRules
        });
    }
}