import { getSocket, getServerUrl, emitAuthUser } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';

const t = (key, fallback) => GlobalLocalization.t(key, fallback);
const tf = (key, fallback, ...args) => GlobalLocalization.format(key, fallback, ...args);
const RENDER_OAUTH_FALLBACK_SERVER = 'https://fivesapi.onrender.com';

function normalizeServerBase(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (e) {
    return null;
  }
}

export default class OnlineAccountScene extends Phaser.Scene {
  constructor() {
    super('OnlineAccountScene');
    this.user = null;
    this._onAuthUpdated = null;
    this.passwordInput = null;
    this.loginUserInput = null;
    this.loginPassInput = null;
    this.oauthPopup = null;
    this.oauthPollTimer = null;
    this.oauthServerBase = null;
    this.oauthExpectedProvider = null;
    this.debugger = DebugManager.create(this, { namespace: 'OnlineAccountScene' });
    this.debug = this.debugger.enabled;
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

    if (this.input && this.input.keyboard) {
      this._escHandler = (event) => {
        if (event.repeat) return;
        this.handleEscPressed();
      };
      this.input.keyboard.on('keydown-ESC', this._escHandler);
      this.events.once('shutdown', () => {
        if (this.input && this.input.keyboard && this._escHandler) {
          this.input.keyboard.off('keydown-ESC', this._escHandler);
        }
        this._escHandler = null;
      });
    }
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
    let serverResponded = false;

    // Try server auth (if available) then fallback to localStorage
    try {
      const server = getServerUrl();
      const res = await fetch(`${server.replace(/\/$/, '')}/auth/me`, { credentials: 'include' });
      serverResponded = true;
      if (res.ok) {
        const text = await res.text();
        try {
          const j = JSON.parse(text);
          if (j?.ok && j.user) {
            this.user = j.user;
            if (this.debugger) this.debugger.log('auth refresh: server ok', { id: this.user.id, type: this.user.type });

            // Inform socket of authenticated identity (authoritative server user)
            try {
              emitAuthUser(this.user);
            } catch (e) {
              console.warn('Socket auth emit failed', e);
            }

            // persist cached copy client-side
            localStorage.setItem('fives_user', JSON.stringify(j.user));
            return;
          }

          // Server explicitly says "not authenticated": clear stale local cache.
          if (j && j.ok === false) {
            this.user = null;
            localStorage.removeItem('fives_user');
            emitAuthUser(null);
            return;
          }
        } catch (err) {
          console.warn('/auth/me non-JSON:', text);
        }
      }
    } catch (err) {
      console.warn('Auth check failed (server):', err);
    }

    // If server responded but did not provide a valid authenticated user payload,
    // do not trust stale client cache.
    if (serverResponded) {
      this.user = null;
      localStorage.removeItem('fives_user');
      emitAuthUser(null);
      if (this.debugger) this.debugger.log('auth refresh: server responded without valid session');
      return;
    }

    // Fallback: localStorage
    const raw = localStorage.getItem('fives_user');
    if (raw) {
      try {
        this.user = JSON.parse(raw);
        if (this.debugger) this.debugger.log('auth refresh: cached', { id: this.user?.id, type: this.user?.type });
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
        localStorage.removeItem('fives_user');
      }
    }

    this.user = null;
    if (this.debugger) this.debugger.log('auth refresh: none');
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

    this.add.text(640, 140, t('ACCOUNT_LOGIN_TITLE', 'Login to Fives'), { fontSize: 48 }).setOrigin(0.5);

    // Fetch available auth methods asynchronously
    this.getAvailableAuthMethods().then(methods => {
      let yPos = 260;

      // Google login
      if (methods.google) {
        const googleBtn = this.add.text(640, yPos, t('ACCOUNT_LOGIN_GOOGLE', 'Login with Google'), {
          fontSize: 32, color: '#ffeb3b'
        }).setOrigin(0.5).setInteractive();

        googleBtn.on('pointerdown', async () => {
          GlobalAudio.playButton(this);
          await this.oauthLogin('/auth/google');
        });
        yPos += 60;
      } else {
        this.add.text(640, yPos, t('ACCOUNT_GOOGLE_UNAVAILABLE', 'Google OAuth (not configured)'), {
          fontSize: 20, color: '#666666'
        }).setOrigin(0.5);
        yPos += 60;
      }

      // Discord login
      if (methods.discord) {
        const discordBtn = this.add.text(640, yPos, t('ACCOUNT_LOGIN_DISCORD', 'Login with Discord'), {
          fontSize: 32, color: '#7289da'
        }).setOrigin(0.5).setInteractive();

        discordBtn.on('pointerdown', async () => {
          GlobalAudio.playButton(this);
          await this.oauthLogin('/auth/discord/authorize');
        });
      } else {
        this.add.text(640, yPos, t('ACCOUNT_DISCORD_UNAVAILABLE', 'Discord OAuth (not configured)'), {
          fontSize: 20, color: '#666666'
        }).setOrigin(0.5);
      }
    });

    // Guest Signup (always available)
    this.add.text(640, 400, t('ACCOUNT_GUEST_SIGNUP_TITLE', 'Or Sign Up as Guest'), {
      fontSize: 28, color: '#cccccc'
    }).setOrigin(0.5);

    // Password input with title
    this.add.text(640, 440, t('ACCOUNT_PASSWORD_PROMPT', 'Choose Your Password'), {
      fontSize: 20, color: '#aaaaaa'
    }).setOrigin(0.5);

    // Create styled DOM input and keep a reference so we can destroy it reliably
    this.passwordInput = this.add.dom(640, 470, 'input', {
      type: 'password',
      placeholder: t('ACCOUNT_PASSWORD_PLACEHOLDER', '6+ characters'),
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
    const cachedUser = localStorage.getItem('fives_user');
    const guestCreatedAt = Number(localStorage.getItem('fives_guest_created_at') || 0);
    const now = Date.now();
    const WAIT_MS = 24 * 60 * 60 * 1000;
    const guestBlocked = !!cachedUser || (guestCreatedAt && (now - guestCreatedAt) < WAIT_MS);

    const guestBtn = this.add.text(640, 520, t('ACCOUNT_CREATE_GUEST', 'Create Guest Account'), {
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
        this.add.text(640, 550, tf('ACCOUNT_GUEST_LOCKED', 'Guest creation locked for {0}h', left), { fontSize: 16, color: '#ffcc66' }).setOrigin(0.5);
      } else if (cachedUser) {
        this.add.text(640, 550, t('ACCOUNT_GUEST_ALREADY_CACHED', 'You already have an account cached locally.'), { fontSize: 16, color: '#ffcc66' }).setOrigin(0.5);
      }
    }

    // Guest Login Labels + inputs
    this.add.text(640, 580, t('ACCOUNT_GUEST_USERNAME_LABEL', 'Guest Username:'), { fontSize: 20, color: '#aaaaaa' }).setOrigin(0.5);
    this.loginUserInput = this.add.dom(640, 610, 'input', {
      type: 'text',
      placeholder: t('ACCOUNT_GUEST_USERNAME_PLACEHOLDER', 'Guest username'),
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

    this.add.text(640, 650, t('ACCOUNT_GUEST_PASSWORD_LABEL', 'Guest Password:'), { fontSize: 20, color: '#aaaaaa' }).setOrigin(0.5);
    this.loginPassInput = this.add.dom(640, 680, 'input', {
      type: 'password',
      placeholder: t('ACCOUNT_GUEST_PASSWORD_PLACEHOLDER', 'Password'),
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

    this.loginBtn = this.add.text(640, 720, t('ACCOUNT_GUEST_LOGIN', 'Login as Guest'), { fontSize: 20, color: '#66aaff' }).setOrigin(0.5).setInteractive();
    this.loginBtn.on('pointerdown', () => this.loginGuest());

    this.makeCancelButton();
  }

  _clearOAuthState(closePopup = false) {
    if (this.oauthPollTimer) {
      clearInterval(this.oauthPollTimer);
      this.oauthPollTimer = null;
    }

    if (closePopup && this.oauthPopup && !this.oauthPopup.closed) {
      try { this.oauthPopup.close(); } catch (e) { /* ignore */ }
    }

    this.oauthPopup = null;
    this.oauthServerBase = null;
    this.oauthExpectedProvider = null;
  }

  async _waitForOAuthSession(timeoutMs = 60000, pollIntervalMs = 700) {
    const server = (this.oauthServerBase || getServerUrl()).replace(/\/$/, '');
    const expectedProvider = this.oauthExpectedProvider;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      this.oauthPollTimer = setInterval(async () => {
        if (this.oauthPopup && this.oauthPopup.closed) {
          reject(new Error('OAuth popup closed before login finished'));
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error('OAuth login timed out'));
          return;
        }

        try {
          const res = await fetch(`${server}/auth/me`, { credentials: 'include' });
          if (!res.ok) return;

          const body = await res.json();
          const userType = body?.user?.type || null;
          if (body?.ok && body.user && (!expectedProvider || userType === expectedProvider)) {
            resolve(body.user);
          }
        } catch (err) {
          // Keep polling while OAuth flow is in progress.
        }
      }, pollIntervalMs);
    });
  }

  async _waitForOAuthPopupMessage(timeoutMs = 60000) {
    const expectedPrimary = normalizeServerBase(this.oauthServerBase || getServerUrl());
    const expectedFallback = normalizeServerBase(RENDER_OAUTH_FALLBACK_SERVER);
    const allowedOrigins = new Set([expectedPrimary, expectedFallback].filter(Boolean));
    const expectedProvider = this.oauthExpectedProvider;

    return new Promise((resolve, reject) => {
      let finished = false;
      let timeoutId = null;
      let closeWatchId = null;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (timeoutId) clearTimeout(timeoutId);
        if (closeWatchId) clearInterval(closeWatchId);
        window.removeEventListener('message', onMessage);
      };

      const fail = (err) => {
        cleanup();
        reject(err);
      };

      const succeed = (user) => {
        cleanup();
        resolve(user);
      };

      const onMessage = (event) => {
        const eventOrigin = normalizeServerBase(event?.origin || '');
        if (!eventOrigin || !allowedOrigins.has(eventOrigin)) return;

        const data = event?.data;
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'fives-oauth-success') return;
        if (expectedProvider && data.provider !== expectedProvider) return;
        if (!data.user || !data.user.id) return;
        if (expectedProvider && data.user.type !== expectedProvider) return;

        succeed(data.user);
      };

      window.addEventListener('message', onMessage);

      timeoutId = setTimeout(() => {
        fail(new Error('OAuth login timed out'));
      }, timeoutMs);

      closeWatchId = setInterval(() => {
        if (this.oauthPopup && this.oauthPopup.closed) {
          fail(new Error('OAuth popup closed before login finished'));
        }
      }, 250);
    });
  }

  _appendPopupState(url) {
    if (/[?&]state=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}state=popup`;
  }

  _expectedProviderForUrl(url) {
    const value = String(url || '').toLowerCase();
    if (value.includes('/auth/google')) return 'google';
    if (value.includes('/auth/discord')) return 'discord';
    return null;
  }

  async _resetAuthSession(serverBase) {
    const base = normalizeServerBase(serverBase);
    if (!base) return;

    try {
      await fetch(`${base}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (e) {
      // Best effort - continue OAuth flow even if pre-reset fails.
    }
  }

  async _probeOAuthServer(serverBase, timeoutMs = 1200) {
    const normalized = normalizeServerBase(serverBase);
    if (!normalized) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${normalized}/health`, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal
      });
      return !!res?.ok;
    } catch (err) {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async _resolveOAuthServerBase() {
    const primary = normalizeServerBase(getServerUrl()) || RENDER_OAUTH_FALLBACK_SERVER;
    const fallback = RENDER_OAUTH_FALLBACK_SERVER;

    if (primary === fallback) return fallback;

    const primaryHost = (() => {
      try { return new URL(primary).hostname.toLowerCase(); } catch (e) { return ''; }
    })();

    // Custom domain may be unavailable; verify it before OAuth redirect flow.
    if (primaryHost === 'api.fivesdicegame.com') {
      const customHealthy = await this._probeOAuthServer(primary, 1200);
      if (customHealthy) return primary;
      if (this.debugger) this.debugger.warn('oauth server fallback', { from: primary, to: fallback, reason: 'custom-domain-unreachable' });
      return fallback;
    }

    const healthy = await this._probeOAuthServer(primary, 900);
    if (healthy) return primary;

    const fallbackHealthy = await this._probeOAuthServer(fallback, 1200);
    if (fallbackHealthy) {
      if (this.debugger) this.debugger.warn('oauth server fallback', { from: primary, to: fallback, reason: 'primary-unreachable' });
      return fallback;
    }

    return primary;
  }

  async oauthLogin(url) {
    try {
      if (this.debugger) this.debugger.log('oauth login start', { url });
      this._clearOAuthState(true);
      this.oauthExpectedProvider = this._expectedProviderForUrl(url);

      const server = await this._resolveOAuthServerBase();
      this.oauthServerBase = server;
      await this._resetAuthSession(server);

      const popupUrlPath = this._appendPopupState(url);
      const popupUrl = `${server.replace(/\/$/, '')}${popupUrlPath.startsWith('/') ? '' : '/'}${popupUrlPath}`;
      const topLevelUrl = `${server.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
      const popupFeatures = 'popup=yes,width=520,height=720,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes';
      this.oauthPopup = window.open(popupUrl, 'fives_oauth', popupFeatures);

      // Popup blocked: fallback to top-level redirect (required for OAuth on strict browsers).
      if (!this.oauthPopup || typeof this.oauthPopup.closed === 'undefined') {
        alert(t('ACCOUNT_OAUTH_POPUP_BLOCKED', 'Popup blocked. Redirecting to complete login...'));
        window.location.assign(topLevelUrl);
        return;
      }

      const user = await Promise.any([
        this._waitForOAuthPopupMessage(60000),
        this._waitForOAuthSession(60000, 700)
      ]);
      if (!user) {
        alert(t('ACCOUNT_OAUTH_FAILED_NO_USER', 'OAuth login failed: no user session found.'));
        return;
      }

      this._clearOAuthState(true);

      localStorage.setItem('fives_user', JSON.stringify(user));
      this.user = user;
      if (this.debugger) this.debugger.log('oauth login success', { id: user?.id, type: user?.type });

      try {
        emitAuthUser(user);
      } catch (e) { /* ignore */ }

      alert(tf('ACCOUNT_LOGIN_SUCCESS', 'Logged in as {0}', user.name || t('GENERIC_UNKNOWN', 'Unknown')));
      this.game.events.emit('auth-updated');
      this.scene.resume(this.returnTo);
      this.scene.stop();
    } catch (err) {
      this._clearOAuthState(true);
      console.error('[OAuth] Error during login:', err);
      if (this.debugger) this.debugger.error('oauth login error', { error: err?.message || String(err) });

      const aggregateReasons = Array.isArray(err?.errors) ? err.errors : [];
      const primaryReason = aggregateReasons.find(Boolean);
      const message = String(primaryReason?.message || err?.message || '');
      if (message.includes('popup closed')) {
        alert(t('ACCOUNT_OAUTH_POPUP_CLOSED', 'OAuth window was closed before login finished.'));
        return;
      }
      if (message.includes('timed out')) {
        alert(t('ACCOUNT_OAUTH_TIMEOUT', 'OAuth login timed out. Please try again.'));
        return;
      }

      const msg = err.message || t('ACCOUNT_NETWORK_ERROR_FALLBACK', 'Could not connect to server');
      alert(tf('ACCOUNT_NETWORK_ERROR', 'Network error: {0}', msg));
    }
  }

  // ----------------------------
  // Guest Register
  // ----------------------------
  async createGuestAccount() {
    GlobalAudio.playButton(this);
    if (!this.passwordInput || !this.passwordInput.node) {
      alert(t('ACCOUNT_INPUT_MISSING', 'Input missing'));
      return;
    }
    const password = (this.passwordInput.node.value || '').trim();
    if (!password || password.length < 6) {
      alert(t('ACCOUNT_PASSWORD_TOO_SHORT', 'Password must be at least 6 characters'));
      return;
    }
    try {
      if (this.debugger) this.debugger.log('guest register start');
      const resp = await fetch(`${getServerUrl()}/auth/guest/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      const j = await resp.json();
      if (j.ok && j.user) {
        this.user = j.user;
        if (this.debugger) this.debugger.log('guest register success', { id: j.user?.id, name: j.user?.name });
        localStorage.setItem('fives_user', JSON.stringify(j.user));
        localStorage.setItem('fives_guest_created_at', String(Date.now())); // prevent immediate re-creation

        // Inform socket immediately
        emitAuthUser(j.user);

        alert(tf('ACCOUNT_GUEST_CREATED', 'Guest created!\nUsername: {0}\nPassword: {1}', j.user.name, password));
        this.game.events.emit('auth-updated');
        this.scene.resume(this.returnTo);
        this.scene.stop();
      } else {
        if (this.debugger) this.debugger.warn('guest register failed', { error: j?.error || 'unknown' });
        alert(t('ACCOUNT_GUEST_CREATE_FAILED', 'Guest creation failed'));
      }
    } catch (err) {
      console.error(err);
      if (this.debugger) this.debugger.error('guest register error', { error: err?.message || String(err) });
      alert(t('ACCOUNT_NETWORK_ERROR_SHORT', 'Network error'));
    }
  }

  // ----------------------------
  // Guest Login
  // ----------------------------
  async loginGuest() {
    GlobalAudio.playButton(this);
    if (!this.loginUserInput || !this.loginPassInput) {
      alert(t('ACCOUNT_INPUT_MISSING', 'Input missing'));
      return;
    }
    const username = (this.loginUserInput.node.value || '').trim();
    const password = (this.loginPassInput.node.value || '').trim();
    if (!username || !password) { alert(t('ACCOUNT_ENTER_CREDENTIALS', 'Enter credentials')); return; }
    try {
      if (this.debugger) this.debugger.log('guest login start', { username });
      const resp = await fetch(`${getServerUrl()}/auth/guest/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      const j = await resp.json();
      if (j.ok && j.user) {
        this.user = j.user;
        if (this.debugger) this.debugger.log('guest login success', { id: j.user?.id, name: j.user?.name });
        localStorage.setItem('fives_user', JSON.stringify(j.user));

        // Inform socket
        emitAuthUser(j.user);

        alert(tf('ACCOUNT_LOGIN_WELCOME', 'Welcome, {0}', j.user.name));
        this.game.events.emit('auth-updated');
        this.scene.resume(this.returnTo);
        this.scene.stop();
      } else {
        const reason = j.error || t('ACCOUNT_LOGIN_CHECK_CREDS', 'Check username/password');
        if (this.debugger) this.debugger.warn('guest login failed', { reason });
        alert(tf('ACCOUNT_LOGIN_FAILED', 'Login failed: {0}', reason));
      }
    } catch (err) {
      console.error(err);
      if (this.debugger) this.debugger.error('guest login error', { error: err?.message || String(err) });
      alert(t('ACCOUNT_NETWORK_ERROR_SHORT', 'Network error'));
    }
  }

  // ============================
  // ACCOUNT OPTIONS (when logged in)
  // ============================
  showAccountOptions() {
    // Rebuild UI
    this.refreshUI();

    const { name, type } = this.user || {};
    const safeName = name || t('GENERIC_UNKNOWN', 'Unknown');
    this.add.text(640, 130, t('ACCOUNT_OPTIONS_TITLE', 'Account Options'), { fontSize: 42 }).setOrigin(0.5);
    this.add.text(640, 190, tf('ACCOUNT_LOGGED_IN_AS', 'Logged in as: {0}', safeName), { fontSize: 28 }).setOrigin(0.5);

    // Change display name for non-guests (local only)
    if (type !== 'guest') {
      const changeBtn = this.add.text(640, 270, t('ACCOUNT_CHANGE_NAME', 'Change Display Name'), { fontSize: 30, color: '#55ccff' })
        .setOrigin(0.5).setInteractive();
      changeBtn.on('pointerdown', async () => {
        const newName = prompt(t('ACCOUNT_CHANGE_NAME_PROMPT', 'Enter new display name:'));
        if (!newName || newName.trim().length < 2) return;
        const updated = { ...this.user, name: newName.trim() };
        this.user = updated;
        localStorage.setItem('fives_user', JSON.stringify(updated));
        alert(t('ACCOUNT_NAME_UPDATED', 'Name updated locally. Implement server-side rename later.'));
        this.game.events.emit('auth-updated');
        this.scene.resume(this.returnTo);
        this.scene.stop();
      });
    }

    // Sign-out
    const signOutBtn = this.add.text(640, 350, t('ACCOUNT_SIGN_OUT', 'Sign Out'), { fontSize: 30, color: '#ff4444' })
      .setOrigin(0.5).setInteractive();

    signOutBtn.on('pointerdown', async () => {
      try {
        await fetch(`${getServerUrl().replace(/\/$/, '')}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch (e) { console.warn('Logout request failed', e); }
      localStorage.removeItem('fives_user');

      // Inform socket that we're unauthenticated
      emitAuthUser(null);
      if (this.debugger) this.debugger.log('sign out');

      alert(t('ACCOUNT_SIGNED_OUT', 'Signed out'));
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
    const cancelBtn = this.add.text(640, 750, t('UI_CANCEL', 'Cancel'), { fontSize: 28 }).setOrigin(0.5).setInteractive();
    cancelBtn.on('pointerdown', () => {
      GlobalAudio.playButton(this);
      this.closeModal();
    });
  }

  handleEscPressed() {
    this.closeModal();
  }

  closeModal() {
    this.scene.resume(this.returnTo);
    this.scene.stop();
  }

  // ----------------------------
  // Cleanup
  // ----------------------------
  shutdown() {
    this._clearOAuthState(true);

    // Remove auth listener
    if (this._onAuthUpdated) {
      this.game.events.off('auth-updated', this._onAuthUpdated);
      this._onAuthUpdated = null;
    }

    // Destroy DOM inputs if present
    this._destroyDomInputs();
  }
}
