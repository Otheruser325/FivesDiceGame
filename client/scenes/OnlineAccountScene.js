import { getSocket, getServerUrl, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';

export default class OnlineAccountScene extends Phaser.Scene {
  constructor() {
    super('OnlineAccountScene');
    this.user = null;
    this._onAuthUpdated = null;
    this.passwordInput = null;
    this.loginUserInput = null;
    this.loginPassInput = null;
  }

  init(data) {
    this.returnTo = data.returnTo || 'OnlineMenuScene';
  }

  create() {
    ErrorHandler.setScene(this);
    
    // translucent background rectangle (recreated on UI rebuild)
    this.bg = this.add.rectangle(640, 480, 1280, 960, 0x000000, 0.85);

    // Load user and build UI (refreshAuth includes localStorage fallback)
    this.refreshAuth().then(() => {
      if (this.user) this.showAccountOptions();
      else this.showLoginOptions();
    });

    // Rebuild UI when auth changes (single bound handler)
    this._onAuthUpdated = async () => {
      await this.refreshAuth();
      if (this.user) this.showAccountOptions();
      else this.showLoginOptions();
    };
    this.game.events.on('auth-updated', this._onAuthUpdated);

    this.events.on('shutdown', () => this.shutdown());
  }

  // Do a safe UI refresh: destroy DOM inputs, remove children and re-add background first
  refreshUI() {
    // destroy any DOM inputs first (Phaser won't always remove them automatically)
    this._destroyDomInputs();

    // remove all children (safe) and re-add background
    this.children.removeAll();
    this.bg = this.add.rectangle(640, 480, 1280, 960, 0x000000, 0.85);
  }

  // Helper: destroy DOM inputs safely
  _destroyDomInputs() {
    const safeDestroy = el => {
      if (!el) return;
      try {
        // Phaser's DOMElement has destroy(); also remove node if still present
        if (typeof el.destroy === 'function') el.destroy();
        if (el.node && el.node.parentNode) el.node.parentNode.removeChild(el.node);
      } catch (e) {
        // ignore
      }
    };

    safeDestroy(this.passwordInput);
    safeDestroy(this.loginUserInput);
    safeDestroy(this.loginPassInput);

    this.passwordInput = null;
    this.loginUserInput = null;
    this.loginPassInput = null;
  }

  // ----------------------------
  // AUTH HANDLING
  // ----------------------------
  async refreshAuth() {
    // Try server auth (if available) then fallback to localStorage
    try {
      const server = getServerUrl();
      const res = await fetch(`${server.replace(/\/$/, '')}/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          if (j?.ok && j.user) {
            this.user = j.user;

            // Inform socket of authenticated identity (authoritative server user)
            try {
              emitAuthUser(this.user);
            } catch (e) {
              console.warn('Socket auth emit failed', e);
            }

            // persist cached copy client-side
            localStorage.setItem('protodice_user', JSON.stringify(j.user));
            return;
          }
        } catch (err) {
          console.warn('/auth/me non-JSON:', text);
        }
      }
    } catch (err) {
      console.warn('Auth check failed (server):', err);
    }

    // Fallback: localStorage
    const raw = localStorage.getItem('protodice_user');
    if (raw) {
      try {
        this.user = JSON.parse(raw);
        // tell socket about cached user as well (best-effort)
        try {
          const socket = getSocket && typeof getSocket === 'function' ? getSocket() : null;
          if (socket && socket.emit && this.user) {
            socket.emit('auth-user', this.user);
            socket.userId = this.user.id;
          }
        } catch (e) {}
        return;
      } catch (e) {
        console.warn('Corrupt local user cache', e);
        localStorage.removeItem('protodice_user');
      }
    }

    this.user = null;
    // also notify socket that we're unauthenticated
    try {
      emitAuthUser(null);
    } catch (e) {}
  }

  /**
   * Fetch available auth methods from server
   * @returns {Promise<{guest: boolean, google: boolean, discord: boolean}>}
   */
  async getAvailableAuthMethods() {
    try {
      const server = getServerUrl();
      const res = await fetch(`${server.replace(/\/$/, '')}/auth/methods`);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('[Auth] Failed to fetch available auth methods:', err);
    }
    // Fallback: assume guest is always available
    return { guest: true, google: false, discord: false };
  }

  // ============================
  // LOGIN / REGISTER UI
  // ============================
  showLoginOptions() {
    // rebuild UI from scratch
    this.refreshUI();

    this.add.text(640, 140, 'Login to Protodice', { fontSize: 48 }).setOrigin(0.5);

    // Fetch available auth methods asynchronously
    this.getAvailableAuthMethods().then(methods => {
      let yPos = 260;

      // Google login
      if (methods.google) {
        const googleBtn = this.add.text(640, yPos, 'Login with Google', {
          fontSize: 32, color: '#ffeb3b'
        }).setOrigin(0.5).setInteractive();

        googleBtn.on('pointerdown', async () => {
          GlobalAudio.playButton(this);
          await this.oauthLogin('/auth/google?redirect=json');
        });
        yPos += 60;
      } else {
        this.add.text(640, yPos, 'Google OAuth (not configured)', {
          fontSize: 20, color: '#666666'
        }).setOrigin(0.5);
        yPos += 60;
      }

      // Discord login
      if (methods.discord) {
        const discordBtn = this.add.text(640, yPos, 'Login with Discord', {
          fontSize: 32, color: '#7289da'
        }).setOrigin(0.5).setInteractive();

        discordBtn.on('pointerdown', async () => {
          GlobalAudio.playButton(this);
          // Use the new proxy endpoint to avoid CORS issues
          await this.oauthLogin('/auth/discord/authorize');
        });
      } else {
        this.add.text(640, yPos, 'Discord OAuth (not configured)', {
          fontSize: 20, color: '#666666'
        }).setOrigin(0.5);
      }
    });

    // Guest Signup (always available)
    this.add.text(640, 400, 'Or Sign Up as Guest', {
      fontSize: 28, color: '#cccccc'
    }).setOrigin(0.5);

    // Password input with title
    this.add.text(640, 440, 'Choose Your Password', {
      fontSize: 20, color: '#aaaaaa'
    }).setOrigin(0.5);

    // Create styled DOM input and keep a reference so we can destroy it reliably
    this.passwordInput = this.add.dom(640, 470, 'input', {
      type: 'password',
      placeholder: '6+ characters',
      style: `
        width: 250px;
        font-size: 22px;
        padding: 6px;
        background: rgba(0,0,0,0.5);
        color: #ffffff;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 6px;
        outline: none;
        font-family: Arial, sans-serif;
      `
    });

    // Add focus/blur events for better UX
    if (this.passwordInput?.node) {
      try {
        this.passwordInput.node.addEventListener('focus', () => {
          if (this.passwordInput?.node) this.passwordInput.node.style.border = '1px solid #66ff66';
        });
        this.passwordInput.node.addEventListener('blur', () => {
          if (this.passwordInput?.node) this.passwordInput.node.style.border = '1px solid rgba(255,255,255,0.3)';
        });
      } catch (err) {
        console.warn('[OnlineAccountScene] Failed to attach password input listeners:', err);
      }
    }

    // Restrict guest creation if localStorage has a user or recent guest created
    const cachedUser = localStorage.getItem('protodice_user');
    const guestCreatedAt = Number(localStorage.getItem('protodice_guest_created_at') || 0);
    const now = Date.now();
    const WAIT_MS = 24 * 60 * 60 * 1000;
    const guestBlocked = !!cachedUser || (guestCreatedAt && (now - guestCreatedAt) < WAIT_MS);

    const guestBtn = this.add.text(640, 520, 'Create Guest Account', {
      fontSize: 28,
      color: guestBlocked ? '#777777' : '#00ffaa'
    }).setOrigin(0.5);

    if (!guestBlocked) {
      guestBtn.setInteractive();
      guestBtn.on('pointerdown', () => this.createGuestAccount());
    } else {
      // show a tooltip/time-left if blocked
      if (!cachedUser && guestCreatedAt) {
        const left = Math.ceil((WAIT_MS - (now - guestCreatedAt)) / 3600000);
        this.add.text(640, 550, `Guest creation locked for ${left}h`, { fontSize: 16, color: '#ffcc66' }).setOrigin(0.5);
      } else if (cachedUser) {
        this.add.text(640, 550, `You already have an account cached locally.`, { fontSize: 16, color: '#ffcc66' }).setOrigin(0.5);
      }
    }

    // Guest Login Labels + inputs
    this.add.text(640, 550, "Guest Username:", { fontSize: 20, color: "#aaaaaa" }).setOrigin(0.5);
    this.loginUserInput = this.add.dom(640, 580, "input", {
      type: "text",
      placeholder: "Guest username",
      style: `
        width: 200px;
        font-size: 20px;
        padding: 6px;
        background: rgba(0,0,0,0.5);
        color: #ffffff;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 6px;
        outline: none;
        font-family: Arial, sans-serif;
      `
    });

    // Add focus/blur events for login username input
    if (this.loginUserInput?.node) {
      try {
        this.loginUserInput.node.addEventListener('focus', () => {
          if (this.loginUserInput?.node) this.loginUserInput.node.style.border = '1px solid #66ff66';
        });
        this.loginUserInput.node.addEventListener('blur', () => {
          if (this.loginUserInput?.node) this.loginUserInput.node.style.border = '1px solid rgba(255,255,255,0.3)';
        });
      } catch (err) {
        console.warn('[OnlineAccountScene] Failed to attach username input listeners:', err);
      }
    }

    this.add.text(640, 620, "Guest Password:", { fontSize: 20, color: "#aaaaaa" }).setOrigin(0.5);
    this.loginPassInput = this.add.dom(640, 650, "input", {
      type: "password",
      placeholder: "Password",
      style: `
        width: 200px;
        font-size: 20px;
        padding: 6px;
        background: rgba(0,0,0,0.5);
        color: #ffffff;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 6px;
        outline: none;
        font-family: Arial, sans-serif;
      `
    });

    // Add focus/blur events for login password input
    if (this.loginPassInput?.node) {
      try {
        this.loginPassInput.node.addEventListener('focus', () => {
          if (this.loginPassInput?.node) this.loginPassInput.node.style.border = '1px solid #66ff66';
        });
        this.loginPassInput.node.addEventListener('blur', () => {
          if (this.loginPassInput?.node) this.loginPassInput.node.style.border = '1px solid rgba(255,255,255,0.3)';
        });
      } catch (err) {
        console.warn('[OnlineAccountScene] Failed to attach login password listeners:', err);
      }
    }

    this.loginBtn = this.add.text(640, 680, 'Login as Guest', { fontSize: 20, color: '#66aaff' }).setOrigin(0.5).setInteractive();
    this.loginBtn.on('pointerdown', () => this.loginGuest());

    this.makeCancelButton();
  }

  async oauthLogin(url) {
    try {
      const server = getServerUrl();
      const fullUrl = `${server.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
      const resp = await fetch(fullUrl, { credentials: 'include' });
      
      // Check response status first
      if (!resp.ok) {
        const text = await resp.text();
        console.error('[OAuth] Server returned error:', resp.status, text);
        
        // Try to parse as JSON if it looks like JSON
        if (text.trim().startsWith('{')) {
          try {
            const errData = JSON.parse(text);
            alert(`OAuth Error: ${errData.error || 'Unknown error'}`);
          } catch (e) {
            alert(`OAuth failed: Server error ${resp.status}`);
          }
        } else {
          // HTML error page or redirect
          alert('OAuth configuration issue on server. Please check server logs.');
        }
        return;
      }
      
      // Try to parse response as JSON
      let j;
      const contentType = resp.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        j = await resp.json();
      } else {
        const text = await resp.text();
        try {
          j = JSON.parse(text);
        } catch (e) {
          console.error('[OAuth] Response is not JSON:', text.substring(0, 100));
          alert('OAuth error: Server returned invalid response. Check that Discord/Google credentials are configured.');
          return;
        }
      }
      
      if (j.ok && j.user) {
        localStorage.setItem('protodice_user', JSON.stringify(j.user));
        this.user = j.user;

        // Inform socket
        try {
          emitAuthUser(j.user);
        } catch (e) { /* ignore */ }

        alert(`Logged in as ${j.user.name}`);
        this.game.events.emit('auth-updated');
        this.scene.resume(this.returnTo);
        this.scene.stop();
      } else {
        const reason = j.error || 'Unknown error';
        alert(`OAuth login failed: ${reason}`);
      }
    } catch (err) {
      console.error('[OAuth] Error during login:', err);
      alert('Network error: ' + (err.message || 'Could not connect to server'));
    }
  }

  // ----------------------------
  // Guest Register
  // ----------------------------
  async createGuestAccount() {
    GlobalAudio.playButton(this);
    if (!this.passwordInput || !this.passwordInput.node) {
      alert('Input missing');
      return;
    }
    const password = (this.passwordInput.node.value || '').trim();
    if (!password || password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      const resp = await fetch(`${getServerUrl()}/auth/guest/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      const j = await resp.json();
      if (j.ok && j.user) {
        this.user = j.user;
        localStorage.setItem('protodice_user', JSON.stringify(j.user));
        localStorage.setItem('protodice_guest_created_at', String(Date.now())); // prevent immediate re-creation

        // Inform socket immediately
        emitAuthUser(j.user);

        alert(`Guest created!\nUsername: ${j.user.name}\nPassword: ${password}`);
        this.game.events.emit('auth-updated');
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
    if (!this.loginUserInput || !this.loginPassInput) {
      alert('Input missing');
      return;
    }
    const username = (this.loginUserInput.node.value || '').trim();
    const password = (this.loginPassInput.node.value || '').trim();
    if (!username || !password) { alert('Enter credentials'); return; }
    try {
      const resp = await fetch(`${getServerUrl()}/auth/guest/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      const j = await resp.json();
      if (j.ok && j.user) {
        this.user = j.user;
        localStorage.setItem('protodice_user', JSON.stringify(j.user));

        // Inform socket
        emitAuthUser(j.user);

        alert(`Welcome, ${j.user.name}`);
        this.game.events.emit('auth-updated');
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
    // Rebuild UI
    this.refreshUI();

    const { name, type } = this.user || {};
    this.add.text(640, 130, 'Account Options', { fontSize: 42 }).setOrigin(0.5);
    this.add.text(640, 190, `Logged in as: ${name}`, { fontSize: 28 }).setOrigin(0.5);

    // Change display name for non-guests (local only)
    if (type !== 'guest') {
      const changeBtn = this.add.text(640, 270, 'Change Display Name', { fontSize: 30, color: '#55ccff' })
        .setOrigin(0.5).setInteractive();
      changeBtn.on('pointerdown', async () => {
        const newName = prompt('Enter new display name:');
        if (!newName || newName.trim().length < 2) return;
        const updated = { ...this.user, name: newName.trim() };
        this.user = updated;
        localStorage.setItem('protodice_user', JSON.stringify(updated));
        alert('Name updated locally. Implement server-side rename later.');
        this.game.events.emit('auth-updated');
        this.scene.resume(this.returnTo);
        this.scene.stop();
      });
    }

    // Sign-out
    const signOutBtn = this.add.text(640, 350, 'Sign Out', { fontSize: 30, color: '#ff4444' })
      .setOrigin(0.5).setInteractive();

    signOutBtn.on('pointerdown', async () => {
      try {
        await fetch(`${getServerUrl().replace(/\/$/, '')}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (e) { console.warn('Logout request failed', e); }
      localStorage.removeItem('protodice_user');

      // Inform socket that we're unauthenticated
      emitAuthUser(null);

      alert('Signed out');
      this.game.events.emit('auth-updated');
      this.scene.resume(this.returnTo);
      this.scene.stop();
    });

    this.makeCancelButton();
  }

  // ----------------------------
  // Cancel button
  // ----------------------------
  makeCancelButton() {
    const cancelBtn = this.add.text(640, 750, 'Cancel', { fontSize: 28 }).setOrigin(0.5).setInteractive();
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
    // Remove auth listener
    if (this._onAuthUpdated) {
      this.game.events.off('auth-updated', this._onAuthUpdated);
      this._onAuthUpdated = null;
    }

    // Destroy DOM inputs if present
    this._destroyDomInputs();
  }
}