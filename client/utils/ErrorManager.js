import GlobalLocalization from './LocalizationManager.js';

class ErrorManager {
    static errors = [];
    static _scene = null;
    static _container = null;
    static _escHandler = null;
    static _recoveryHandler = null;
    static _pendingErrors = [];
    static _currentEntry = null;
    static _displayCooldownUntil = 0;
    static _displayTimer = null;
    static _maxPendingErrors = 25;

    static {
        ErrorManager._setupGlobalHandlers();
    }

    /* ---------- GLOBAL HANDLERS ---------- */
    static _setupGlobalHandlers() {
        if (typeof window === 'undefined') return;

        // Handle uncaught errors
        window.addEventListener('error', (event) => {
            try {
                const err = event && (event.error || event.message) ? (event.error || event.message) : new Error('Unknown uncaught error');
                if (ErrorManager._isNonCriticalBrowserError(err)) {
                    if (typeof event.preventDefault === 'function') {
                        try {
                            event.preventDefault();
                        } catch (e) {}
                    }
                    return;
                }
                console.error('[ErrorManager] Uncaught error:', err);
                ErrorManager.logError(err);
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
                if (ErrorManager._isNonCriticalBrowserError(reason)) {
                    if (typeof event.preventDefault === 'function') {
                        try {
                            event.preventDefault();
                        } catch (e) {}
                    }
                    return;
                }
                console.error('[ErrorManager] Unhandled promise rejection:', reason);
                const message = (reason instanceof Error) ? reason : new Error(String(reason));
                ErrorManager.logError(new Error(`Unhandled Promise: ${message?.message || String(message)}` ));
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
    static setScene(scene) {
        ErrorManager._scene = scene;
        ErrorManager._attemptDisplayQueue();
    }

    /**
     * Register a custom recovery callback (scene-specific cleanup).
     * Should be a zero-arg function (or async) that tries to repair known scene invariants.
     */
    static registerRecoveryHandler(fn) {
        if (typeof fn === 'function') ErrorManager._recoveryHandler = fn;
    }

    /* ---------- LOGGING ---------- */
    static logError(errOrMsg, meta = {}) {
        try {
            if (ErrorManager._isNonCriticalBrowserError(errOrMsg)) return;
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
            ErrorManager.errors.push(entry);
            console.error('[ErrorManager][LOG]', entry);

            // If it's a sprite/texture related error, attempt targeted recover heuristics
            if (/sprite|texture|frame|parse|null|undefined/i.test(msg)) {
                // best-effort immediate heuristics (non-blocking)
                try {
                    ErrorManager._attemptSpriteRecovery(ErrorManager._scene, error);
                } catch (e) {
                    console.warn('[ErrorManager] recovery heuristic failed', e);
                }

            }
            ErrorManager._queueForDisplay(entry);
            ErrorManager._attemptDisplayQueue();
        } catch (e) {
            // last-resort: print to console
            console.error('[ErrorManager] logError internal failure', e);
        }
    }

    static getErrorType(error) {
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

    static _isNonCriticalBrowserError(errOrMsg) {
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

    static getErrorConfig(errorType) {
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
    static displayError(scene, message = 'Unknown error', errorType = 'error', entry = null) {
        try {
            ErrorManager._currentEntry = entry || ErrorManager._currentEntry;
            const config = ErrorManager.getErrorConfig(errorType);
            const displayMessage = ErrorManager._truncate(message);

            // If there's already a container, refresh text instead of creating new
            if (!scene || !scene.add || !scene.cameras) {
                // fallback: console only
                console.warn('[ErrorManager] No scene available to display error — logging only');
                return;
            }

            // Prevent multiple containers
            if (ErrorManager._container) {
                // update shown text
                try {
                    const body = ErrorManager._container.getByName?.('err_body') || ErrorManager._container.list?.find(i => i.name === 'err_body');
                    if (body && body.setText) body.setText(displayMessage);
                    const title = ErrorManager._container.getByName?.('err_title') || ErrorManager._container.list?.find(i => i.name === 'err_title');
                    if (title && title.setText) title.setText(config.title);
                } catch (e) {}
                return;
            }

            // ensure safe references
            ErrorManager._scene = scene;

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
                fontSize: 32,
                color: config.hex
            }).setOrigin(0.5).setDepth(10002);
            titleText.name = 'err_title';

            const bodyText = scene.add.text(cx, cy - 8, displayMessage, {
                fontSize: 24,
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
                    fontSize: 28,
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
                    await ErrorManager._runRecover(scene, ErrorManager._currentEntry);
                    ErrorManager.fadeOut(); // hide on success/attempt
                } catch (e) {
                    console.warn('[ErrorManager] recover failed', e);
                    // leave popup visible for manual Reload or Close
                }
            }, '#66ff66');

            const detailsBtn = makeBtn(GlobalLocalization.t('ERROR_DETAILS', 'Show Details'), -80, () => {
                try {
                    const current = ErrorManager._currentEntry;
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

            const closeBtn = makeBtn(GlobalLocalization.t('UI_CLOSE', 'CLOSE'), 220, () => {
                try {
                    ErrorManager.fadeOut();
                } catch (e) {
                    ErrorManager.hide();
                }
            }, '#ff6666');

            const container = scene.add.container(0, 0, [blocker, panel, titleText, bodyText, recoverBtn, detailsBtn, reloadBtn, closeBtn]);
            container.setDepth(10000);
            ErrorManager._container = container;
            ErrorManager._displayCooldownUntil = Date.now() + 600;

            // keyboard ESC handler
            try {
                ErrorManager._escHandler = (evt) => {
                    try {
                        evt.stopPropagation();
                        ErrorManager.fadeOut();
                    } catch (e) {
                        ErrorManager.hide();
                    }
                };
                if (scene.input && scene.input.keyboard) scene.input.keyboard.on('keydown-ESC', ErrorManager._escHandler);
            } catch (e) {
                console.warn('[ErrorManager] keyboard handler failed', e);
            }

            // auto clean up when scene shuts down/destroyed
            try {
                if (scene.events) {
                    scene.events.once('shutdown', () => {
                        try {
                            ErrorManager.hide();
                        } catch (e) {}
                    });
                    scene.events.once('destroy', () => {
                        try {
                            ErrorManager.hide();
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

    static _truncate(msg, n = 1000) {
        if (!msg) return '';
        if (msg.length <= n) return msg;
        return msg.slice(0, n - 3) + '...';
    }

    static fadeOut() {
        try {
            if (!ErrorManager._scene || !ErrorManager._container) {
                ErrorManager.hide();
                return;
            }

            if (ErrorManager._scene.tweens && typeof ErrorManager._scene.tweens.add === 'function') {
                ErrorManager._scene.tweens.add({
                    targets: ErrorManager._container,
                    alpha: 0,
                    duration: 200,
                    onComplete: () => {
                        try {
                            ErrorManager.hide();
                        } catch (e) {
                            ErrorManager.hide();
                        }
                    }
                });
            } else {
                ErrorManager.hide();
            }
        } catch (e) {
            console.warn('[ErrorManager] fadeOut failed', e);
            ErrorManager.hide();
        }
    }

    static hide() {
        try {
            // remove keyboard handler
            try {
                if (ErrorManager._scene && ErrorManager._scene.input && ErrorManager._scene.input.keyboard && ErrorManager._escHandler) {
                    if (typeof ErrorManager._scene.input.keyboard.off === 'function') {
                        ErrorManager._scene.input.keyboard.off('keydown-ESC', ErrorManager._escHandler);
                    }
                    ErrorManager._escHandler = null;
                }
            } catch (e) {
                console.warn('[ErrorManager] removing keyboard failed', e);
            }

            // destroy container and children safely
            try {
                if (ErrorManager._container && typeof ErrorManager._container.destroy === 'function') {
                    // remove children individually to avoid lingering listeners
                    try {
                        (ErrorManager._container.list || []).slice().forEach(child => {
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
                        ErrorManager._container.destroy(true);
                    } catch (e) {
                        ErrorManager._container.destroy();
                    }
                }
            } catch (e) {
                console.warn('[ErrorManager] container destroy failed', e);
            } finally {
                ErrorManager._container = null;
            }

            // do not clear _scene — keep reference for potential recovery

            ErrorManager._attemptDisplayQueue();
        } catch (e) {
            console.warn('[ErrorManager] hide unexpected failure', e);
            ErrorManager._container = null;
            ErrorManager._escHandler = null;
        }
    }

    /* ---------- DISPLAY QUEUE ---------- */
    static _queueForDisplay(entry) {
        try {
            if (!entry) return;
            ErrorManager._pendingErrors.push(entry);
            if (ErrorManager._pendingErrors.length > ErrorManager._maxPendingErrors) {
                ErrorManager._pendingErrors.shift();
            }
        } catch (e) {}
    }

    static _isSceneReady(scene) {
        try {
            if (!scene || !scene.add || !scene.cameras) return false;
            if (scene.sys && scene.sys.settings && scene.sys.settings.isBooted === false) return false;
            if (scene.scene && typeof scene.scene.isActive === 'function' && !scene.scene.isActive()) return false;
            return true;
        } catch (e) {
            return false;
        }
    }

    static _scheduleDisplayAttempt(delayMs = 150) {
        try {
            if (ErrorManager._displayTimer) return;
            ErrorManager._displayTimer = setTimeout(() => {
                ErrorManager._displayTimer = null;
                ErrorManager._attemptDisplayQueue();
            }, Math.max(50, delayMs));
        } catch (e) {}
    }

    static _attemptDisplayQueue() {
        try {
            if (ErrorManager._pendingErrors.length === 0) return;

            const scene = ErrorManager._scene;
            if (!scene) return;
            if (!ErrorManager._isSceneReady(scene)) {
                ErrorManager._scheduleDisplayAttempt(200);
                return;
            }

            if (ErrorManager._container) {
                const latest = ErrorManager._pendingErrors.pop();
                ErrorManager._pendingErrors.length = 0;
                if (latest) {
                    try {
                        ErrorManager.displayError(scene, latest.message, latest.type, latest);
                    } catch (e) {
                        console.warn('[ErrorManager] displayError failed while updating', e);
                    }
                }
                return;
            }

            const now = Date.now();
            if (now < ErrorManager._displayCooldownUntil) {
                ErrorManager._scheduleDisplayAttempt(ErrorManager._displayCooldownUntil - now + 50);
                return;
            }

            const entry = ErrorManager._pendingErrors.shift();
            if (!entry) return;
            try {
                ErrorManager.displayError(scene, entry.message, entry.type, entry);
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
    static async _runRecover(scene, entry = null) {
        // 1) try scene-provided handler
        if (ErrorManager._recoveryHandler) {
            try {
                const res = ErrorManager._recoveryHandler();
                if (res && typeof res.then === 'function') await res;
            } catch (e) {
                console.warn('[ErrorManager] custom recovery handler failed', e);
            }
        }

        // 2) attempt sprite/texture heuristics
        try {
            await ErrorManager._attemptSpriteRecovery(scene, entry);
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

    /* ---------- UTIL ---------- */
    static getErrors() {
        return ErrorManager.errors.slice();
    }
    static clearErrors() {
        ErrorManager.errors = [];
    }
}

const GlobalErrors = ErrorManager;
export default GlobalErrors;



