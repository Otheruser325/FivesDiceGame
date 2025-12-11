import { getSocket } from '../utils/SocketManager.js';
import { GlobalAudio } from '../utils/AudioManager.js';

export default class OnlineAccountScene extends Phaser.Scene {
    constructor() {
        super('OnlineAccountScene');
        this.user = null;
    }

    init(data) {
        this.returnTo = data.returnTo || 'OnlineMenuScene';
    }

    create() {
        this.add.rectangle(640, 480, 1280, 960, 0x000000, 0.85);

        // Load user and build UI
        this.refreshAuth().then(() => {
            if (this.user) this.showAccountOptions();
            else this.showLoginOptions();
        });

        this.events.on('shutdown', () => this.shutdown());
        this.game.events.on("auth-updated", async () => {
            await this.refreshAuth();
            this.refreshUI();
        });
    }

    refreshUI() {
        this.children.removeAll();
        this.scene.restart();
    }

    // ----------------------------
    // AUTH HANDLING
    // ----------------------------
    async refreshAuth() {
        // Try server auth
        try {
            const res = await fetch('/auth/me', {
                credentials: 'include'
            });
            const text = await res.text();

            try {
                const j = JSON.parse(text);
                if (j?.ok && j.user) {
                    this.user = j.user;
                    if (this.user && getSocket) {
                        getSocket.emit('auth-user', this.user);
                        getSocket.userId = this.user.id;
                    }
                    localStorage.setItem('fives_user', JSON.stringify(j.user));
                    return;
                }
            } catch (err) {
                console.warn('/auth/me non-JSON:', text);
            }
        } catch (err) {
            console.warn('Auth check failed', err);
        }

        // Fallback: localStorage
        const raw = localStorage.getItem('fives_user');
        if (raw) {
            try {
                this.user = JSON.parse(raw);
                return;
            } catch {
                console.warn('Corrupt local user cache');
                localStorage.removeItem('fives_user');
            }
        }

        this.user = null;
    }

    // ============================
    // LOGIN / REGISTER UI
    // ============================
    showLoginOptions() {
        this.add.text(640, 140, 'Login to Fives', {
            fontSize: 48
        }).setOrigin(0.5);

        // Google login
        const googleBtn = this.add.text(640, 260, 'Login with Google', {
            fontSize: 32,
            color: '#ffeb3b'
        }).setOrigin(0.5).setInteractive();

        googleBtn.on('pointerdown', async () => {
            GlobalAudio.playButton(this);
            await this.oauthLogin('/auth/google?redirect=json');
        });

        // Discord login
        const discordBtn = this.add.text(640, 320, 'Login with Discord', {
            fontSize: 32,
            color: '#7289da'
        }).setOrigin(0.5).setInteractive();

        discordBtn.on('pointerdown', async () => {
            GlobalAudio.playButton(this);
            await this.oauthLogin('/auth/discord?redirect=json');
        });

        // Guest Signup
        this.add.text(640, 400, 'Or Sign Up as Guest', {
            fontSize: 28,
            color: '#cccccc'
        }).setOrigin(0.5);

        // Password input with title 
        this.add.text(640, 440, 'Choose Your Password', {
            fontSize: 20,
            color: '#aaaaaa'
        }).setOrigin(0.5);
        
        this.passwordInput = this.add.dom(640, 470, 'input', {
            width: '250px',
            fontSize: '22px',
            padding: '6px',
            type: 'password',
            placeholder: '6+ characters'
        });

        const guestBtn = this.add.text(640, 520, 'Create Guest Account', {
            fontSize: 28,
            color: '#00ffaa'
        }).setOrigin(0.5).setInteractive();

        guestBtn.on('pointerdown', () => this.createGuestAccount());

        // Guest Login Labels
        this.add.text(640, 550, "Guest Username:", {
            fontSize: 20,
            color: "#aaaaaa"
        }).setOrigin(0.5);

        this.loginUserInput = this.add.dom(640, 580, "input", {
            width: "200px",
            fontSize: "20px",
            padding: "4px",
            placeholder: "Guest username"
        });

        // Password Label
        this.add.text(640, 620, "Guest Password:", {
            fontSize: 20,
            color: "#aaaaaa"
        }).setOrigin(0.5);

        this.loginPassInput = this.add.dom(640, 650, "input", {
            width: "200px",
            fontSize: "20px",
            padding: "4px",
            type: "password",
            placeholder: "Password"
        });

        this.loginBtn = this.add.text(640, 680, 'Login as Guest', {
            fontSize: 20,
            color: '#66aaff'
        }).setOrigin(0.5).setInteractive();

        this.loginBtn.on('pointerdown', () => this.loginGuest());

        this.makeCancelButton();
    }

    async oauthLogin(url) {
        try {
            const resp = await fetch(url, {
                credentials: 'include'
            });
            const j = await resp.json();
            if (j.ok && j.user) {
                localStorage.setItem('fives_user', JSON.stringify(j.user));
                this.user = j.user;

                alert(`Logged in as ${j.user.name}`);
                this.game.events.emit("auth-updated");

                this.scene.resume(this.returnTo);
                this.scene.stop();
            } else {
                alert('OAuth login failed');
            }
        } catch (err) {
            console.error(err);
            alert('Network error');
        }
    }

    // ----------------------------
    // Guest Register
    // ----------------------------
    async createGuestAccount() {
        GlobalAudio.playButton(this);
        const password = this.passwordInput.node.value.trim();
        if (!password || password.length < 6) {
            alert('Password must be at least 6 characters');
            return;
        }
        try {
            const resp = await fetch('/auth/guest/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    password
                })
            });
            const j = await resp.json();
            if (j.ok && j.user) {
                this.user = j.user;
                localStorage.setItem('fives_user', JSON.stringify(j.user));
                alert(`Guest created!\nUsername: ${j.user.name}\nPassword: ${password}`);
                this.game.events.emit("auth-updated");
                this.scene.resume(this.returnTo);
                this.scene.stop();
            } else {
                alert('Guest creation failed');
            }
        } catch (err) {
            console.error(err);
            alert('Network error');
        }
    }

    // ----------------------------
    // Guest Login
    // ----------------------------
    async loginGuest() {
        GlobalAudio.playButton(this);
        const username = this.loginUserInput.node.value.trim();
        const password = this.loginPassInput.node.value.trim();
        if (!username || !password) {
            alert('Enter credentials');
            return;
        }
        try {
            const resp = await fetch('/auth/guest/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    username,
                    password
                })
            });
            const j = await resp.json();
            if (j.ok && j.user) {
                this.user = j.user;
                localStorage.setItem('fives_user', JSON.stringify(j.user));
                alert(`Welcome, ${j.user.name}`);
                this.game.events.emit("auth-updated");
                this.scene.resume(this.returnTo);
                this.scene.stop();
            } else {
                alert(`Login failed: ${j.error || 'Check username/password'}`);
            }
        } catch (err) {
            console.error(err);
            alert('Network error');
        }
    }

    // ============================
    // ACCOUNT OPTIONS (when logged in)
    // ============================
    showAccountOptions() {
        const {
            name,
            type
        } = this.user;

        this.add.text(640, 130, 'Account Options', {
            fontSize: 42
        }).setOrigin(0.5);
        this.add.text(640, 190, `Logged in as: ${name}`, {
            fontSize: 28
        }).setOrigin(0.5);

        // Only allow renaming non-guests (guests random usernames)
        if (type !== 'guest') {
            const changeBtn = this.add.text(640, 270, 'Change Display Name', {
                fontSize: 30,
                color: '#55ccff'
            }).setOrigin(0.5).setInteractive();

            changeBtn.on('pointerdown', async () => {
                const newName = prompt('Enter new display name:');
                if (!newName || newName.trim().length < 2) return;

                // TODO: send rename to server (future feature)
                const updated = {
                    ...this.user,
                    name: newName.trim()
                };
                this.user = updated;

                localStorage.setItem('fives_user', JSON.stringify(updated));

                alert('Name updated locally. Implement server-side rename later.');

                this.game.events.emit("auth-updated");
                this.scene.resume(this.returnTo);
                this.scene.stop();
            });
        }

        // Sign-out
        const signOutBtn = this.add.text(640, 350, 'Sign Out', {
            fontSize: 30,
            color: '#ff4444'
        }).setOrigin(0.5).setInteractive();

        signOutBtn.on('pointerdown', async () => {
            await fetch('/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });

            localStorage.removeItem('fives_user');
            alert('Signed out');

            this.game.events.emit("auth-updated");

            this.scene.resume(this.returnTo);
            this.scene.stop();
        });

        this.makeCancelButton();
    }

    // ----------------------------
    // Cancel button
    // ----------------------------
    makeCancelButton() {
        const cancelBtn = this.add.text(640, 750, 'Cancel', {
            fontSize: 28
        }).setOrigin(0.5).setInteractive();

        cancelBtn.on('pointerdown', () => {
            GlobalAudio.playButton(this);
            this.scene.resume(this.returnTo);
            this.scene.stop();
        });
    }

    // ----------------------------
    // Cleanup
    // ----------------------------
    shutdown() {
        if (this.passwordInput) this.passwordInput.destroy();
        if (this.loginUserInput) this.loginUserInput.destroy();
        if (this.loginPassInput) this.loginPassInput.destroy();

        this.passwordInput = null;
        this.loginUserInput = null;
        this.loginPassInput = null;
    }
}