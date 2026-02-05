import GlobalLocalization from './LocalizationManager.js';

class ErrorManager {
    constructor() {
        this.errors = [];
        this._scene = null;
        this._container = null;
        this._escHandler = null;
        this._recoveryHandler = null;
        this._pendingErrors = [];
        this._currentEntry = null;
        this._displayCooldownUntil = 0;
        this._displayTimer = null;
        this._maxPendingErrors = 25;
        this._setupGlobalHandlers();
    }

    /* ---------- GLOBAL HANDLERS ---------- */
    _setupGlobalHandlers() {
        if (typeof window === 'undefined') return;

        // Handle uncaught errors
        window.addEventListener('error', (event) => {
            try {
                const err = event && (event.error || event.message) ? (event.error || event.message) : new Error('Unknown uncaught error');
                if (this._isNonCriticalBrowserError(err)) {
                    if (typeof event.preventDefault === 'function') {
                        try {
                            event.preventDefault();
                        } catch (e) {}
                    }
                    return;
                }
                console.error('[ErrorManager] Uncaught error:', err);
                this.logError(err);
                if (typeof event.preventDefault === 'function') {
                    try {
                        event.preventDefault();
                    } catch (e) {}
                }
            } catch (e) {
                console.error('[ErrorManager] fatal in global error handler', e);
            }
        });

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            try {
                const reason = event && event.reason ? event.reason : 'Unhandled rejection';
                if (this._isNonCriticalBrowserError(reason)) {
                    if (typeof event.preventDefault === 'function') {
                        try {
                            event.preventDefault();
                        } catch (e) {}
                    }
                    return;
                }
                console.error('[ErrorManager] Unhandled promise rejection:', reason);
                const message = (reason instanceof Error) ? reason : new Error(String(reason));
                this.logError(new Error(`Unhandled Promise: ${message?.message || String(message)}`));
                if (typeof event.preventDefault === 'function') {
                    try {
                        event.preventDefault();
                    } catch (e) {}
                }
            } catch (e) {
                console.error('[ErrorManager] fatal in unhandledrejection handler', e);
            }
        });
    }

    /* ---------- SCENE / RECOVERY API ---------- */
    setScene(scene) {
        this._scene = scene;
        this._attemptDisplayQueue();
    }

    /**
     * Register a custom recovery callback (scene-specific cleanup).
     * Should be a zero-arg function (or async) that tries to repair known scene invariants.
     */
    registerRecoveryHandler(fn) {
        if (typeof fn === 'function') this._recoveryHandler = fn;
    }

    /* ---------- LOGGING ---------- */
    logError(errOrMsg, meta = {}) {
        try {
            if (this._isNonCriticalBrowserError(errOrMsg)) return;
            const now = Date.now();
            const error = (errOrMsg instanceof Error) ? errOrMsg : new Error(String(errOrMsg));
            const msg = error.message || String(error);
            const stack = error.stack || null;
            const type = this.getErrorType(error);

            const entry = {
                message: msg,
                type,
                stack,
                timestamp: now,
                meta
            };
            this.errors.push(entry);
            console.error('[ErrorManager][LOG]', entry);

            // If it's a sprite/texture related error, attempt targeted recover heuristics
            if (/sprite|texture|frame|parse|null|undefined/i.test(msg)) {
                // best-effort immediate heuristics (non-blocking)
                try {
                    this._attemptSpriteRecovery(this._scene, error);
                } catch (e) {
                    console.warn('[ErrorManager] recovery heuristic failed', e);
                }

            }
            this._queueForDisplay(entry);
            this._attemptDisplayQueue();
        } catch (e) {
            // last-resort: print to console
            console.error('[ErrorManager] logError internal failure', e);
        }
    }

    getErrorType(error) {
        try {
            if (error instanceof SyntaxError) return 'syntax';
            if (error instanceof TypeError) return 'type';
            if (error instanceof ReferenceError) return 'reference';
            if (error instanceof RangeError) return 'range';
            return 'error';
        } catch (e) {
            return 'error';
        }
    }

    _isNonCriticalBrowserError(errOrMsg) {
        try {
            if (!errOrMsg) return false;
            const name = errOrMsg?.name ? String(errOrMsg.name) : '';
            const message = (errOrMsg instanceof Error)
                ? (errOrMsg.message || '')
                : String(errOrMsg);
            const msg = message.toLowerCase();
            if (msg.includes('unable to decode audio data')) return true;
            if (msg.includes('decode audio data')) return true;
            if (msg.includes('the audio element has no supported sources')) return true;
            if (msg.includes('failed to load because no supported source was found')) return true;
            if (msg.includes('the element has no supported sources')) return true;
            if (msg.includes('notallowederror') && msg.includes('play()')) return true;
            if (msg.includes('play() failed because the user didn')) return true;
            if (msg.includes('the play() request was interrupted')) return true;
            if (/encodingerror/i.test(name) && msg.includes('audio')) return true;
            if (/notsupportederror/i.test(name) && msg.includes('audio')) return true;

            const assetExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.json', '.atlas', '.xml', '.fnt', '.ttf', '.woff', '.woff2', '.mp3', '.ogg', '.wav', '.m4a'];
            const hasAssetExt = assetExts.some(ext => msg.includes(ext));
            const looksLikeAsset = msg.includes('assets/') || msg.includes('asset/');
            if (hasAssetExt || looksLikeAsset) {
                if (msg.includes('failed to load') || msg.includes('load failed') || msg.includes('not found') || msg.includes('404')) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    getErrorConfig(errorType) {
        const t = (key, fallback) => GlobalLocalization.t(key, fallback);
        const configs = {
            syntax: { title: t('ERROR_SYNTAX', 'Syntax Error'), color: 0xff6666, hex: '#ff6666' },
            type: { title: t('ERROR_TYPE', 'Type Error'), color: 0xff9966, hex: '#ff9966' },
            reference: { title: t('ERROR_REFERENCE', 'Reference Error'), color: 0xffcc66, hex: '#ffcc66' },
            range: { title: t('ERROR_RANGE', 'Range Error'), color: 0xffcc99, hex: '#ffcc99' },
            error: { title: t('ERROR_GENERIC', 'Error'), color: 0xffcc66, hex: '#ffcc66' }
        };

        if (!errorType) return configs.error;
        return configs[errorType] || configs.error;
    }

    /* ---------- DISPLAY UI (safe) ---------- */
    /**
     * message: string
     * entry: original error entry (optional) - used for Show Details button
     */
    displayError(scene, message = 'Unknown error', errorType = 'error', entry = null) {
        try {
            this._currentEntry = entry || this._currentEntry;
            const config = this.getErrorConfig(errorType);
            const displayMessage = this._truncate(message);

            // If there's already a container, refresh text instead of creating new
            if (!scene || !scene.add || !scene.cameras) {
                // fallback: console only
                console.warn('[ErrorManager] No scene available to display error — logging only');
                return;
            }

            // Prevent multiple containers
            if (this._container) {
                // update shown text
                try {
                    const body = this._container.getByName?.('err_body') || this._container.list?.find(i => i.name === 'err_body');
                    if (body && body.setText) body.setText(displayMessage);
                    const title = this._container.getByName?.('err_title') || this._container.list?.find(i => i.name === 'err_title');
                    if (title && title.setText) title.setText(config.title);
                } catch (e) {}
                return;
            }

            // ensure safe references
            this._scene = scene;

            const cam = scene.cameras && scene.cameras.main;
            const cx = cam?.centerX ?? (scene.scale?.width / 2) ?? 600;
            const cy = cam?.centerY ?? (scene.scale?.height / 2) ?? 350;

            const width = Math.min(900, (cam?.width || 1200) - 80);
            const height = 260;

            // block input but keep it shallow (so scene event loops keep running)
            let blocker;
            try {
                blocker = scene.add.rectangle(cx, cy, cam?.width || scene.scale?.width, cam?.height || scene.scale?.height, 0x000000, 0.45)
                    .setDepth(10000)
                    .setInteractive({
                        useHandCursor: false,
                        draggable: false
                    });
            } catch (e) {
                blocker = null;
            }

            const panel = scene.add.rectangle(cx, cy, width, height, 0x1b1b1b)
                .setDepth(10001)
                .setStrokeStyle(3, config.color);

            const titleText = scene.add.text(cx, cy - height / 2 + 24, config.title, {
                fontSize: 24,
                fontFamily: '"Press Start 2P", cursive',
                color: config.hex
            }).setOrigin(0.5).setDepth(10002);
            titleText.name = 'err_title';

            const bodyText = scene.add.text(cx, cy - 8, displayMessage, {
                fontSize: 16,
                fontFamily: '"Press Start 2P", cursive',
                color: '#ffffff',
                align: 'center',
                wordWrap: {
                    width: width - 48
                }
            }).setOrigin(0.5).setDepth(10002);
            bodyText.name = 'err_body';

            // Buttons: Recover | Details | Reload | Close
            const btnY = cy + height / 2 - 36;
            const makeBtn = (label, xOffset, cb, color = '#ffffff') => {
                const b = scene.add.text(cx + xOffset, btnY, label, {
                    fontSize: 18,
                    fontFamily: '"Press Start 2P", cursive',
                    color
                }).setOrigin(0.5).setDepth(10002).setInteractive({
                    useHandCursor: true
                });
                b.on('pointerdown', () => {
                    try {
                        cb();
                    } catch (e) {
                        console.warn('[ErrorManager] button cb error', e);
                    }
                });
                return b;
            };

            const recoverBtn = makeBtn(GlobalLocalization.t('ERROR_RECOVER', 'Attempt Recover'), -220, async () => {
                try {
                    await this._runRecover(scene, this._currentEntry);
                    this.fadeOut(); // hide on success/attempt
                } catch (e) {
                    console.warn('[ErrorManager] recover failed', e);
                    // leave popup visible for manual Reload or Close
                }
            }, '#66ff66');

            const detailsBtn = makeBtn(GlobalLocalization.t('ERROR_DETAILS', 'Show Details'), -80, () => {
                try {
                    const current = this._currentEntry;
                    const details = current ? `${current.message}\n\n${current.stack || ''}` : GlobalLocalization.t('ERROR_NO_DETAILS', 'No further details');
                    // show a bigger dialog or console log; to keep small we copy to console and show short dialog:
                    console.log('[ErrorManager][Details]', details);
                    // update body to show first 1000 chars of details
                    const text = (details.length > 1000) ? details.slice(0, 997) + '...' : details;
                    try {
                        bodyText.setText(text);
                    } catch (e) {}
                } catch (e) {
                    console.warn(e);
                }
            }, '#ffff66');

            const reloadBtn = makeBtn(GlobalLocalization.t('ERROR_RELOAD', 'Reload Page'), 80, () => {
                try {
                    // user opted to reload — do it promptly
                    if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
                        window.location.reload();
                    }
                } catch (e) {
                    console.warn('[ErrorManager] reload failed', e);
                }
            }, '#ffcc66');

            const closeBtn = makeBtn(GlobalLocalization.t('UI_CLOSE', 'Close'), 220, () => {
                try {
                    this.fadeOut();
                } catch (e) {
                    this.hide();
                }
            }, '#ff6666');

            const container = scene.add.container(0, 0, [blocker, panel, titleText, bodyText, recoverBtn, detailsBtn, reloadBtn, closeBtn]);
            container.setDepth(10000);
            this._container = container;
            this._displayCooldownUntil = Date.now() + 600;

            // keyboard ESC handler
            try {
                this._escHandler = (evt) => {
                    try {
                        evt.stopPropagation();
                        this.fadeOut();
                    } catch (e) {
                        this.hide();
                    }
                };
                if (scene.input && scene.input.keyboard) scene.input.keyboard.on('keydown-ESC', this._escHandler);
            } catch (e) {
                console.warn('[ErrorManager] keyboard handler failed', e);
            }

            // auto clean up when scene shuts down/destroyed
            try {
                if (scene.events) {
                    scene.events.once('shutdown', () => {
                        try {
                            this.hide();
                        } catch (e) {}
                    });
                    scene.events.once('destroy', () => {
                        try {
                            this.hide();
                        } catch (e) {}
                    });
                }
            } catch (e) {
                console.warn('[ErrorManager] scene event binding failed', e);
            }
        } catch (e) {
            console.error('[ErrorManager] displayError failure', e);
        }
    }

    _truncate(msg, n = 1000) {
        if (!msg) return '';
        if (msg.length <= n) return msg;
        return msg.slice(0, n - 3) + '...';
    }

    fadeOut() {
        try {
            if (!this._scene || !this._container) {
                this.hide();
                return;
            }

            if (this._scene.tweens && typeof this._scene.tweens.add === 'function') {
                this._scene.tweens.add({
                    targets: this._container,
                    alpha: 0,
                    duration: 200,
                    onComplete: () => {
                        try {
                            this.hide();
                        } catch (e) {
                            this.hide();
                        }
                    }
                });
            } else {
                this.hide();
            }
        } catch (e) {
            console.warn('[ErrorManager] fadeOut failed', e);
            this.hide();
        }
    }

    hide() {
        try {
            // remove keyboard handler
            try {
                if (this._scene && this._scene.input && this._scene.input.keyboard && this._escHandler) {
                    if (typeof this._scene.input.keyboard.off === 'function') {
                        this._scene.input.keyboard.off('keydown-ESC', this._escHandler);
                    }
                    this._escHandler = null;
                }
            } catch (e) {
                console.warn('[ErrorManager] removing keyboard failed', e);
            }

            // destroy container and children safely
            try {
                if (this._container && typeof this._container.destroy === 'function') {
                    // remove children individually to avoid lingering listeners
                    try {
                        (this._container.list || []).slice().forEach(child => {
                            try {
                                if (child && typeof child.removeAllListeners === 'function') child.removeAllListeners();
                                if (child && typeof child.off === 'function') {
                                    try {
                                        child.off('pointerdown');
                                        child.off('pointerover');
                                        child.off('pointerout');
                                    } catch (e) {}
                                }
                                if (child && typeof child.destroy === 'function') child.destroy();
                            } catch (e) {}
                        });
                    } catch (e) {}
                    try {
                        this._container.destroy(true);
                    } catch (e) {
                        this._container.destroy();
                    }
                }
            } catch (e) {
                console.warn('[ErrorManager] container destroy failed', e);
            } finally {
                this._container = null;
            }

            // do not clear _scene — keep reference for potential recovery

            this._attemptDisplayQueue();
        } catch (e) {
            console.warn('[ErrorManager] hide unexpected failure', e);
            this._container = null;
            this._escHandler = null;
        }
    }

    /* ---------- DISPLAY QUEUE ---------- */
    _queueForDisplay(entry) {
        try {
            if (!entry) return;
            this._pendingErrors.push(entry);
            if (this._pendingErrors.length > this._maxPendingErrors) {
                this._pendingErrors.shift();
            }
        } catch (e) {}
    }

    _isSceneReady(scene) {
        try {
            if (!scene || !scene.add || !scene.cameras) return false;
            if (scene.sys && scene.sys.settings && scene.sys.settings.isBooted === false) return false;
            if (scene.scene && typeof scene.scene.isActive === 'function' && !scene.scene.isActive()) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    _scheduleDisplayAttempt(delayMs = 150) {
        try {
            if (this._displayTimer) return;
            this._displayTimer = setTimeout(() => {
                this._displayTimer = null;
                this._attemptDisplayQueue();
            }, Math.max(50, delayMs));
        } catch (e) {}
    }

    _attemptDisplayQueue() {
        try {
            if (this._pendingErrors.length === 0) return;

            const scene = this._scene;
            if (!scene) return;
            if (!this._isSceneReady(scene)) {
                this._scheduleDisplayAttempt(200);
                return;
            }

            if (this._container) {
                const latest = this._pendingErrors.pop();
                this._pendingErrors.length = 0;
                if (latest) {
                    try {
                        this.displayError(scene, latest.message, latest.type, latest);
                    } catch (e) {
                        console.warn('[ErrorManager] displayError failed while updating', e);
                    }
                }
                return;
            }

            const now = Date.now();
            if (now < this._displayCooldownUntil) {
                this._scheduleDisplayAttempt(this._displayCooldownUntil - now + 50);
                return;
            }

            const entry = this._pendingErrors.shift();
            if (!entry) return;
            try {
                this.displayError(scene, entry.message, entry.type, entry);
            } catch (e) {
                console.warn('[ErrorManager] displayError failed', e);
            }
        } catch (e) {
            console.warn('[ErrorManager] _attemptDisplayQueue failed', e);
        }
    }
    /* ---------- RECOVERY ---------- */

    /**
     * Top-level recover runner: runs custom handler and sprite heuristics
     */
    async _runRecover(scene, entry = null) {
        // 1) try scene-provided handler
        if (this._recoveryHandler) {
            try {
                const res = this._recoveryHandler();
                if (res && typeof res.then === 'function') await res;
            } catch (e) {
                console.warn('[ErrorManager] custom recovery handler failed', e);
            }
        }

        // 2) attempt sprite/texture heuristics
        try {
            await this._attemptSpriteRecovery(scene, entry);
        } catch (e) {
            console.warn('[ErrorManager] attemptSpriteRecovery failed', e);
        }

        // 3) attempt to re-enable scene inputs if disabled
        try {
            if (scene && scene.input) {
                try {
                    scene.input.enabled = true;
                } catch (e) {}
                try {
                    scene.input.manager && (scene.input.manager.enabled = true);
                } catch (e) {}
            }
        } catch (e) {}

        // 4) small delay so user can see the result
        await new Promise(r => setTimeout(r, 250));
    }

    /**
     * Heuristic repairs for missing/invalid sprites or textures.
     * - destroys invalid children with missing textures
     * - for `scene.units` and `scene.holders`, if unit.sprite missing, create a simple placeholder shape
     */
    _attemptSpriteRecovery(scene, entry = null) {
        return new Promise((resolve) => {
            try {
                if (!scene) {
                    console.warn('[ErrorManager] no scene for sprite recovery');
                    return resolve();
                }

                // helper: detect invalid sprite/gameobject
                const isInvalidChild = (child) => {
                    try {
                        // gameobject removed/destroyed
                        if (!child || !child.scene) return true;
                        // Sprite/Image — check texture existence
                        const texKey = child.texture?.key;
                        if (texKey) {
                            try {
                                // many Phaser builds have scene.textures.exists
                                if (scene.textures && typeof scene.textures.exists === 'function') {
                                    if (!scene.textures.exists(texKey)) return true;
                                } else if (!texKey) {
                                    return true;
                                }
                            } catch (e) {
                                // conservatively treat as okay
                            }
                        }
                        // some placeholders (rectangle/graphics) won't have texture, that's fine
                        return false;
                    } catch (e) {
                        return true;
                    }
                };

                // 1) destroy invalid children (safely)
                try {
                    const children = (scene.children && scene.children.list) ? scene.children.list.slice() : [];
                    for (const c of children) {
                        try {
                            if (!c) continue;
                            if (isInvalidChild(c)) {
                                // don't destroy critical UI objects by accident:
                                if (c === this._container) continue;
                                try {
                                    c.destroy();
                                } catch (e) {
                                    /* noop */ }
                            }
                        } catch (e) {
                            /* continue */ }
                    }
                } catch (e) {
                    console.warn('[ErrorManager] child scan failed', e);
                }

                // 2) ensure units/hodlers have visible sprites; if not, create a simple placeholder rectangle
                const ensurePlaceholder = (unit, fallbackX = 100, fallbackY = 100) => {
                    try {
                        if (!unit) return;
                        const hasSprite = unit.sprite && unit.sprite.scene;
                        if (hasSprite) return;

                        // compute world position if available
                        let x = fallbackX,
                            y = fallbackY;
                        if (unit.position && typeof unit.position.row === 'number' && typeof unit.position.col === 'number' && typeof scene.getTileXY === 'function') {
                            const t = scene.getTileXY(unit.position.row, unit.position.col);
                            if (t && typeof t.x === 'number') {
                                x = t.x;
                                y = t.y + (scene.UNIT_Y_OFFSET || 0);
                            }
                        } else if (unit._owner !== undefined) {
                            // holder area fallback
                            const baseX = (this._scene && this._scene.currentPlayer === 0) ? 50 : 1100;
                            x = baseX;
                            y = 200;
                        }

                        // create a simple rectangle placeholder
                        const size = Math.max(12, Math.floor((scene.TILE_SIZE || 48) * 0.8));
                        const rect = scene.add.rectangle(x, y, size, size, 0x999999).setOrigin(0.5).setDepth(5000).setInteractive();
                        // attach minimal expected properties used elsewhere
                        unit.sprite = rect;
                        // not using displaySprite to avoid changing original json, but set a fallback
                        unit.displaySprite = unit.displaySprite || null;
                    } catch (e) {
                        // swallow
                    }
                };

                // units
                try {
                    if (Array.isArray(scene.units)) {
                        for (const u of scene.units.slice()) {
                            try {
                                ensurePlaceholder(u);
                            } catch (e) {}
                        }
                    }
                } catch (e) {}

                // holders
                try {
                    if (Array.isArray(scene.holders)) {
                        for (const h of scene.holders.slice()) {
                            try {
                                ensurePlaceholder(h);
                            } catch (e) {}
                        }
                    }
                } catch (e) {}

                // grid cells: if cell exists but sprite is missing while unit remains, attempt to recreate sprite if possible
                try {
                    const rows = scene.grid?.length || 0;
                    for (let r = 0; r < rows; r++) {
                        const cols = scene.grid[r]?.length || 0;
                        for (let c = 0; c < cols; c++) {
                            try {
                                const cell = scene.grid[r][c];
                                if (!cell) continue;
                                if (cell.unit && (!cell.sprite || !cell.sprite.scene)) {
                                    // create placeholder at tile xy
                                    if (typeof scene.getTileXY === 'function') {
                                        const t = scene.getTileXY(r, c);
                                        const size = Math.max(12, Math.floor((scene.TILE_SIZE || 48) * 0.8));
                                        const rect = scene.add.rectangle(t.x, t.y + (scene.UNIT_Y_OFFSET || 0), size, size, 0xaaaaaa).setOrigin(0.5).setDepth(5000).setInteractive();
                                        cell.sprite = rect;
                                        cell.unit.sprite = rect;
                                    } else {
                                        ensurePlaceholder(cell.unit);
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                } catch (e) {}

                // finally: try to rebind a few common UI things
                try {
                    if (scene && scene.input) {
                        try {
                            scene.input.enabled = true;
                        } catch (e) {}
                    }
                } catch (e) {}

                // done
            } catch (e) {
                console.warn('[ErrorManager] _attemptSpriteRecovery outer failure', e);
            } finally {
                // allow next tick for scene to stabilize
                setTimeout(() => resolve(), 60);
            }
        });
    }

    /* ---------- UTIL ---------- */
    getErrors() {
        return this.errors.slice();
    }
    clearErrors() {
        this.errors = [];
    }
}

const ErrorHandler = new ErrorManager();
export default ErrorHandler;



