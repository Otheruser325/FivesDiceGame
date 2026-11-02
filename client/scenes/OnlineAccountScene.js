import { getSocket, getServerUrl, emitAuthUser, fetchWithServerFallback, resolveOAuthServerBase, switchServer, reconnectAfterLogin } from '../utils/SocketManager.js';
import GlobalAudio from '../utils/AudioManager.js';
import ErrorHandler from '../utils/ErrorManager.js';
import GlobalLocalization from '../utils/LocalizationManager.js';
import DebugManager from '../utils/DebugManager.js';
import { markOAuthSuccess, getFreshOAuthCachedUser, saveCachedUser } from '../utils/authRedirect.js';
import { classifyOAuthFailure } from '../utils/oauthFailure.js';

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
    this.oauthLoginInProgress = false;
    this.oauthPollTimer = null;
    this.oauthClaimTimer = null;
    this.oauthNonce = null;
    this.oauthStopped = false;
    this.oauthCancelled = false;
    this.oauthSettled = false;
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
    this._onAuthUpdated = async (user) => {
      if (user && user.id) {
        this.user = user;
      } else {
        await this.refreshAuth();
      }
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
      const res = await fetchWithServerFallback('/auth/me', { credentials: 'include' }, server);
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

          // Server explicitly says "not authenticated": clear stale local cache,
          // unless the popup just completed and this cross-site request cannot see
          // the session cookie (third-party cookie blocking).
          if (j && j.ok === false) {
            const freshUser = getFreshOAuthCachedUser();
            if (freshUser) {
              this.user = freshUser;
              emitAuthUser(freshUser);
              return;
            }
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
      const freshUser = getFreshOAuthCachedUser();
      if (freshUser) {
        this.user = freshUser;
        emitAuthUser(freshUser);
        return;
      }
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
      const res = await fetchWithServerFallback('/auth/methods', {}, server);
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
          await this.oauthLogin('/auth/discord');
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
    if (this.oauthClaimTimer) {
      clearInterval(this.oauthClaimTimer);
      this.oauthClaimTimer = null;
    }

    if (closePopup && this.oauthPopup && !this.oauthPopup.closed) {
      try { this.oauthPopup.close(); } catch (e) { /* ignore */ }
    }

    this.oauthPopup = null;
    this.oauthServerBase = null;
    this.oauthExpectedProvider = null;
    this.oauthNonce = null;
  }

  async _waitForOAuthSession(timeoutMs = 60000, pollIntervalMs = 700, options = {}) {
    const server = (this.oauthServerBase || getServerUrl()).replace(/\/$/, '');
    const expectedProvider = this.oauthExpectedProvider;
    const expectedUserId = options.expectedUserId ? String(options.expectedUserId) : null;
    const ignorePopupClosed = !!options.ignorePopupClosed;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        if (this.oauthPollTimer === pollTimer) {
          this.oauthPollTimer = null;
        }
      };
      const fail = (error) => {
        cleanup();
        reject(error);
      };
      const succeed = (user) => {
        cleanup();
        resolve(user);
      };

      const pollTimer = setInterval(async () => {
        if (finished) return;
        if (this.oauthStopped) {
          fail(new Error('OAuth login failed'));
          return;
        }

        if (!ignorePopupClosed && this.oauthPopup && this.oauthPopup.closed) {
          fail(new Error('OAuth popup closed before login finished'));
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          fail(new Error('OAuth login timed out'));
          return;
        }

        try {
          const res = await fetchWithServerFallback('/auth/me', { credentials: 'include' }, server);
          if (!res.ok) return;

          const body = await res.json();
          const userType = body?.user?.type || null;
          const userId = body?.user?.id ? String(body.user.id) : null;
          if (
            body?.ok &&
            body.user &&
            (!expectedProvider || userType === expectedProvider) &&
            (!expectedUserId || userId === expectedUserId)
          ) {
            succeed(body.user);
          }
        } catch (err) {
          // Keep polling while OAuth flow is in progress.
        }
      }, pollIntervalMs);

      if (this.oauthPollTimer) clearInterval(this.oauthPollTimer);
      this.oauthPollTimer = pollTimer;
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
        // Only the popup opened for this attempt may complete the login.
        if (!this.oauthPopup || !event?.source || event.source !== this.oauthPopup) return;

        const data = event?.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'fives-oauth-error') {
          try {
            event.source.postMessage({ type: 'fives-oauth-ack' }, eventOrigin);
          } catch (e) { /* ignore */ }
          const failure = new Error(String(data.error || 'OAuth sign in failed'));
          if (data.retryable || data.code === 'rate_limited') {
            // A refused attempt. Do not stop the claim path: it can still carry
            // the login another attempt already completed.
            failure.retryable = true;
            failure.code = 'rate_limited';
            fail(failure);
            return;
          }
          failure.oauthFailure = true;
          this.oauthStopped = true;
          fail(failure);
          return;
        }
        if (data.type !== 'fives-oauth-success') return;
        if (expectedProvider && data.provider !== expectedProvider) return;
        if (!data.user || !data.user.id) return;
        if (expectedProvider && data.user.type !== expectedProvider) return;

        try {
          event.source.postMessage({ type: 'fives-oauth-ack' }, eventOrigin);
        } catch (e) { /* ignore */ }

        succeed(data.user);
      };

      window.addEventListener('message', onMessage);

      timeoutId = setTimeout(() => {
        fail(new Error('OAuth login timed out'));
      }, timeoutMs);

      closeWatchId = setInterval(() => {
        if (this.oauthStopped) {
          fail(new Error('OAuth login failed'));
          return;
        }
        if (!this.oauthPopup || this.oauthPopup.closed) {
          fail(new Error('OAuth popup closed before login finished'));
        }
      }, 250);
    });
  }

  // Claims the login this tab started. This is the path that survives the
  // provider severing window.opener (Google does), so the response arrives in
  // the tab that is actually running the game instead of a new one.
  async _waitForOAuthHandoff(timeoutMs = 60000, pollIntervalMs = 900) {
    const nonce = this.oauthNonce;
    const expectedProvider = this.oauthExpectedProvider;
    const server = (this.oauthServerBase || getServerUrl()).replace(/\/$/, '');
    if (!nonce) throw new Error('OAuth handoff unavailable');

    return new Promise((resolve, reject) => {
      let finished = false;
      let inFlight = false;
      let timer = null;
      let resumeAt = 0;
      const deadline = Date.now() + timeoutMs;

      const cleanup = () => {
        if (finished) return;
        finished = true;
        if (timer) clearInterval(timer);
        if (this.oauthClaimTimer === timer) this.oauthClaimTimer = null;
      };
      const succeed = (user) => {
        cleanup();
        resolve(user);
      };
      const fail = (error) => {
        cleanup();
        reject(error);
      };

      const poll = async () => {
        if (finished || inFlight) return;
        if (this.oauthStopped) {
          fail(new Error('OAuth login failed'));
          return;
        }
        if (Date.now() >= deadline) {
          fail(new Error('OAuth login timed out'));
          return;
        }
        // The server asks us to slow down instead of counting our polls as
        // failed sign-ins. Keep the deadline honest rather than hammering it.
        if (Date.now() < resumeAt) return;
        inFlight = true;

        try {
          const res = await fetchWithServerFallback('/auth/oauth/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ nonce })
          }, server);
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get('Retry-After'));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000;
            resumeAt = Date.now() + Math.min(waitMs, 5000);
            return;
          }
          if (!res.ok) return;

          const body = await res.json();
          if (body?.error) {
            const failure = new Error(String(body.error));
            if (body.retryable || body.code === 'rate_limited') {
              failure.retryable = true;
              failure.code = 'rate_limited';
              fail(failure);
              return;
            }
            failure.oauthFailure = true;
            this.oauthStopped = true;
            fail(failure);
            return;
          }
          const user = body?.user;
          if (!body?.ok || !user?.id) return;
          if (expectedProvider && user.type !== expectedProvider) return;
          succeed(user);
        } catch (err) {
          // Keep polling while the OAuth flow is still in progress.
        } finally {
          inFlight = false;
        }
      };

      timer = setInterval(poll, pollIntervalMs);
      this.oauthClaimTimer = timer;
      poll();
    });
  }

  // The exact page this tab is on, so the callback can return to it instead of
  // inventing a URL at the site root. OAuth result parameters are dropped.
  _currentClientPath() {
    try {
      const { pathname = '/', search = '', hash = '' } = window.location || {};
      const params = new URLSearchParams(search);
      ['auth', 'provider', 'error', 'timestamp'].forEach((key) => params.delete(key));
      const query = params.toString();
      const path = `${pathname || '/'}${query ? `?${query}` : ''}${hash || ''}`;
      return path.slice(0, 512);
    } catch (e) {
      return null;
    }
  }

  // A secret only this tab knows. It lets the callback publish the finished
  // login for this tab to claim, which works even when the provider severs
  // window.opener. A weak fallback is worse than none, so skip the handoff when
  // the platform has no cryptographic randomness.
  _createOAuthNonce() {
    try {
      const cryptoApi = globalThis.crypto;
      if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
        return cryptoApi.randomUUID();
      }
      if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) {
      /* fall through */
    }
    return null;
  }

  _appendPopupState(url, { mode = 'popup', nonce = null } = {}) {
    if (/[?&]state=/.test(url)) return url;

    let clientOrigin = null;
    try {
      clientOrigin = window?.location?.origin || null;
    } catch (e) {
      clientOrigin = null;
    }

    const payload = {
      popup: mode !== 'top',
      mode,
      clientOrigin,
      clientPath: this._currentClientPath(),
      clientNonce: nonce || undefined,
      timestamp: Date.now()
    };

    let encodedState = 'popup';
    try {
      const raw = JSON.stringify(payload);
      const base64 = btoa(unescape(encodeURIComponent(raw)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      encodedState = `popup.${base64}`;
    } catch (e) {
      encodedState = 'popup';
    }

    return `${url}${url.includes('?') ? '&' : '?'}state=${encodeURIComponent(encodedState)}`;
  }

  _expectedProviderForUrl(url) {
    const value = String(url || '').toLowerCase();
    if (value.includes('/auth/google')) return 'google';
    if (value.includes('/auth/discord')) return 'discord';
    return null;
  }

  // A pre-existing session, even for the same provider, cannot prove that this
  // attempt succeeded. Only the nonce-bound handoff can recover its result.
  async _recoverOAuthResult() {
    if (this.oauthNonce) {
      try {
        return await this._waitForOAuthHandoff(2500, 500);
      } catch (e) {
        if (e?.oauthFailure || e?.retryable) throw e;
        // No ticket left to claim.
      }
    }

    return null;
  }

  async oauthLogin(url) {
    if (this.oauthLoginInProgress) {
      if (this.oauthPopup && !this.oauthPopup.closed) {
        try { this.oauthPopup.focus(); } catch (e) { /* ignore */ }
      }
      return;
    }
    this.oauthLoginInProgress = true;
    try {
      if (this.debugger) this.debugger.log('oauth login start', { url });
      this._clearOAuthState(true);
      this.oauthStopped = false;
      this.oauthCancelled = false;
      this.oauthSettled = false;
      this.oauthExpectedProvider = this._expectedProviderForUrl(url);

      const preferredServer = getServerUrl();
      const server = await resolveOAuthServerBase(preferredServer);
      if (normalizeServerBase(server) !== normalizeServerBase(preferredServer)) {
        switchServer(server);
        if (this.debugger) this.debugger.warn('oauth server fallback', { from: normalizeServerBase(preferredServer), to: normalizeServerBase(server) });
      }
      this.oauthServerBase = server;

      const nonce = this._createOAuthNonce();
      this.oauthNonce = nonce;

      const base = server.replace(/\/$/, '');
      const popupUrlPath = this._appendPopupState(url, { mode: 'popup', nonce });
      const popupUrl = `${base}${popupUrlPath.startsWith('/') ? '' : '/'}${popupUrlPath}`;
      const popupFeatures = 'popup=yes,width=520,height=720,menubar=no,toolbar=no,status=no,resizable=yes,scrollbars=yes';
      const popupName = `fives_oauth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      this.oauthPopup = window.open(popupUrl, popupName, popupFeatures);

      // Popup blocked: fall back to navigating this tab, and tell the server it
      // is a top-level flow so the callback redirects instead of rendering a
      // completion page in this tab.
      if (!this.oauthPopup || typeof this.oauthPopup.closed === 'undefined') {
        const topLevelPath = this._appendPopupState(url, { mode: 'top', nonce });
        const topLevelUrl = `${base}${topLevelPath.startsWith('/') ? '' : '/'}${topLevelPath}`;
        alert(t('ACCOUNT_OAUTH_POPUP_BLOCKED', 'Popup blocked. Redirecting to complete login...'));
        window.location.assign(topLevelUrl);
        return;
      }

      let pendingUser;
      try {
        pendingUser = await Promise.any([
          this._waitForOAuthPopupMessage(90000),
          this._waitForOAuthHandoff(90000, 900)
        ]);
      } catch (deliveryError) {
        // A late nonce-bound ticket can still prove this attempt succeeded.
        // Never recover from /auth/me: it may be an older session. Terminal
        // provider failures are authoritative and must not be recovered.
        pendingUser = (this.oauthCancelled || this.oauthStopped)
          ? null
          : await this._recoverOAuthResult();
        if (!pendingUser) throw deliveryError;
        if (this.debugger) this.debugger.warn('oauth login recovered after delivery failure');
      }
      if (!pendingUser) {
        alert(t('ACCOUNT_OAUTH_FAILED_NO_USER', 'OAuth login failed: no user session found.'));
        return;
      }
      this.oauthSettled = true;

      // Persist the popup result immediately: if the popup does not receive our
      // acknowledgement it may reload this window, and that reload must not lose
      // a login that already succeeded.
      markOAuthSuccess(this.oauthExpectedProvider || pendingUser.type, pendingUser);
      saveCachedUser(pendingUser);
      this.user = pendingUser;

      // The popup/claim response is already authoritative. Do not let a slow or
      // hanging session check hold the success UI hostage.
      const confirmedUser = await Promise.race([
        this._waitForOAuthSession(3000, 350, {
          expectedUserId: pendingUser?.id,
          ignorePopupClosed: true
        }).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 3300))
      ]);

      // The popup response is authoritative for this window: it came from our
      // popup on the API origin. The session check can fail while third-party
      // cookies are blocked, and refusing the result there would strand the
      // user after a successful sign-in.
      const resolvedUser = confirmedUser || pendingUser;

      if (!confirmedUser) {
        console.warn('[OAuth] Session check did not confirm the popup result; continuing with the popup response');
      }

      this._clearOAuthState(true);

      saveCachedUser(resolvedUser);
      this.user = resolvedUser;
      if (this.debugger) this.debugger.log('oauth login success', { id: resolvedUser?.id, type: resolvedUser?.type });

      // A confirmed session needs a fresh socket handshake with its new cookie.
      // Without confirmation, keep the popup result but do not claim the socket
      // can authenticate when the browser is blocking the session cookie.
      if (confirmedUser) reconnectAfterLogin();

      try {
        emitAuthUser(resolvedUser);
      } catch (e) { /* ignore */ }

      if (confirmedUser) {
        alert(tf('ACCOUNT_LOGIN_SUCCESS', 'Logged in as {0}', resolvedUser.name || t('GENERIC_UNKNOWN', 'Unknown')));
      } else {
        alert(t('ACCOUNT_OAUTH_SESSION_UNCONFIRMED', 'Provider sign-in completed, but the game session could not be confirmed. Online play may require allowing third-party cookies and signing in again.'));
      }
      this.game.events.emit('auth-updated', resolvedUser);
      this.scene.resume(this.returnTo);
      this.scene.stop();
    } catch (err) {
      this._clearOAuthState(true);
      if (this.oauthCancelled) {
        if (this.debugger) this.debugger.log('oauth login cancelled');
        return;
      }

      console.error('[OAuth] Error during login:', err);
      const reasons = Array.isArray(err?.errors) ? err.errors.filter(Boolean) : [err].filter(Boolean);
      if (reasons.length > 1) {
        console.error('[OAuth] Sign-in delivery paths:', reasons.map((reason) => reason?.message || String(reason)));
      }
      if (this.debugger) this.debugger.error('oauth login error', { error: err?.message || String(err) });

      const failure = classifyOAuthFailure(err);
      if (failure.kind === 'reported') {
        alert(failure.message || t('ACCOUNT_OAUTH_FAILED_NO_USER', 'OAuth login failed: no user session found.'));
        return;
      }
      if (failure.kind === 'rate_limited') {
        alert(failure.message || t('ACCOUNT_OAUTH_RATE_LIMITED', 'Too many sign-in attempts. Please wait a minute and try again.'));
        return;
      }
      if (failure.kind === 'cancelled') {
        alert(t('ACCOUNT_OAUTH_POPUP_CLOSED', 'OAuth window was closed before login finished.'));
        return;
      }
      if (failure.kind === 'timeout') {
        alert(t('ACCOUNT_OAUTH_TIMEOUT', 'OAuth login timed out. Please try again.'));
        return;
      }
      if (failure.kind === 'unconfirmed') {
        alert(t('ACCOUNT_OAUTH_UNCONFIRMED', 'Sign in could not be confirmed. Reload the page to check your account.'));
        return;
      }

      const msg = failure.message || t('ACCOUNT_NETWORK_ERROR_FALLBACK', 'Could not connect to server');
      alert(tf('ACCOUNT_NETWORK_ERROR', 'Network error: {0}', msg));
    } finally {
      this.oauthLoginInProgress = false;
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
      const resp = await fetchWithServerFallback('/auth/guest/register', {
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

        // Refresh the existing socket handshake with the new session cookie.
        reconnectAfterLogin();
        emitAuthUser(j.user);

        alert(tf('ACCOUNT_GUEST_CREATED', 'Guest created!\nUsername: {0}\nPassword: {1}', j.user.name, password));
        this.game.events.emit('auth-updated');
        this.scene.resume(this.returnTo);
        this.scene.stop();
      } else {
        if (this.debugger) this.debugger.warn('guest register failed', { error: j?.error || 'unknown' });
        alert(j.error || t('ACCOUNT_GUEST_CREATE_FAILED', 'Guest creation failed'));
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
      const resp = await fetchWithServerFallback('/auth/guest/login', {
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

        // Refresh the existing socket handshake with the new session cookie.
        reconnectAfterLogin();
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
        await fetchWithServerFallback('/auth/logout', { method: 'POST', credentials: 'include' });
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

  // Stops a pending OAuth wait when the player closes the account scene. Without
  // this, oauthLoginInProgress stayed true until every 90s waiter rejected, so
  // the buttons did nothing when the scene was reopened.
  _cancelOAuthLogin() {
    if (!this.oauthLoginInProgress || this.oauthSettled) return;
    this.oauthCancelled = true;
    this.oauthStopped = true;
    this._clearOAuthState(true);
  }

  closeModal() {
    this._cancelOAuthLogin();
    this.scene.resume(this.returnTo);
    this.scene.stop();
  }

  // ----------------------------
  // Cleanup
  // ----------------------------
  shutdown() {
    this._cancelOAuthLogin();
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
