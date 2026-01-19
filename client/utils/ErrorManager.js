class ErrorManager {
    constructor() {
        this.errors = [];
        this._scene = null;
        this._container = null;
        this._escHandler = null;
        this._setupGlobalHandlers();
    }

    /**
     * Setup global error handlers for uncaught exceptions
     * @private
     */
    _setupGlobalHandlers() {
        if (typeof window === 'undefined') return;

        // Handle uncaught errors
        window.addEventListener('error', (event) => {
            console.error('[ErrorManager] Uncaught error:', event.error);
            this.logError(event.error || event.message);
            // Prevent the error from crashing the app
            event.preventDefault();
        });

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('[ErrorManager] Unhandled promise rejection:', event.reason);
            const message = event.reason instanceof Error 
                ? event.reason.message 
                : String(event.reason);
            this.logError(new Error(`Unhandled Promise: ${message}`));
            // Prevent the error from crashing the app
            event.preventDefault();
        });
    }

    /**
     * Initialize ErrorManager with the current scene
     * @param {Phaser.Scene} scene
     */
    setScene(scene) {
        this._scene = scene;
    }

    /**
     * Log an error and display it as a Phaser popup if scene is active
     * @param {Error|string} error
     */
    logError(error) {
        try {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorType = this.getErrorType(error);
            
            this.errors.push({ message: errorMessage, type: errorType, timestamp: Date.now() });
            console.error(`[ErrorManager] ${errorType.toUpperCase()}: ${errorMessage}`);
            
            // Only try to display if scene is properly set and active
            if (this._scene && typeof this._scene.isActive === 'function' && this._scene.isActive?.()) {
                try {
                    this.displayError(this._scene, errorMessage, errorType);
                } catch (displayErr) {
                    console.warn('[ErrorManager] Failed to display error popup:', displayErr?.message);
                    // Error is still logged to console, so we're good
                }
            }
        } catch (err) {
            // Last resort: just log to console if anything fails
            console.error('[ErrorManager] Error in logError itself:', err);
        }
    }

    /**
     * Determine error type based on error object
     * @param {Error|string} error
     * @returns {string}
     */
    getErrorType(error) {
        if (error instanceof SyntaxError) return 'syntax';
        if (error instanceof TypeError) return 'type';
        if (error instanceof ReferenceError) return 'reference';
        if (error instanceof RangeError) return 'range';
        return 'error';
    }

    /**
     * Display error as a Phaser popup modal
     * @param {Phaser.Scene} scene
     * @param {string} message
     * @param {string} errorType
     */
    displayError(scene, message, errorType = 'error') {
        try {
            // Validate scene and required methods
            if (!scene || typeof scene.add !== 'object' || !scene.add.rectangle || !scene.cameras) {
                console.warn('[ErrorManager] Scene invalid or missing required methods');
                return;
            }

            this.hide();
            this._scene = scene;

            const cam = scene.cameras.main;
            if (!cam) {
                console.warn('[ErrorManager] No main camera available');
                return;
            }

            const cx = cam.centerX;
            const cy = cam.centerY;

            if (typeof cx !== 'number' || typeof cy !== 'number') {
                console.warn('[ErrorManager] Camera center coordinates invalid');
                return;
            }

            const config = this.getErrorConfig(errorType);

            const width = 600;
            const height = 240;

            // Truncate very long messages
            const displayMessage = message.length > 500 
                ? message.substring(0, 497) + '...' 
                : message;

            // Blocker (captures input BEFORE scene handlers)
            const blocker = scene.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.5)
                .setDepth(10000)
                .setInteractive({ swallowPointer: true });

            // Panel
            const panel = scene.add.rectangle(cx, cy, width, height, 0x1e1e1e)
                .setStrokeStyle(3, config.color);

            // Title
            const titleText = scene.add.text(cx, cy - height / 2 + 26, config.title, {
                fontSize: 24,
                color: config.hex
            }).setOrigin(0.5);

            // Message
            const bodyText = scene.add.text(cx, cy - 10, displayMessage, {
                fontSize: 18,
                color: '#ffffff',
                align: 'center',
                wordWrap: { width: width - 48 }
            }).setOrigin(0.5);

            // Close button
            const closeBtn = scene.add.text(cx, cy + height / 2 - 32, 'Close', {
                fontSize: 20,
                color: '#ff6666'
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

            // Handle close button click safely
            closeBtn.on('pointerdown', () => {
                try {
                    this.fadeOut();
                } catch (closeErr) {
                    console.warn('[ErrorManager] Error during fadeOut:', closeErr);
                    this.hide();
                }
            });

            const container = scene.add.container(0, 0, [
                blocker,
                panel,
                titleText,
                bodyText,
                closeBtn
            ]);

            container.setDepth(10000);
            this._container = container;

            // Setup keyboard handler safely
            try {
                this._escHandler = (event) => {
                    try {
                        event.stopPropagation();
                        this.fadeOut();
                    } catch (escErr) {
                        console.warn('[ErrorManager] Error during ESC handler:', escErr);
                        this.hide();
                    }
                };

                if (scene.input && scene.input.keyboard) {
                    scene.input.keyboard.on('keydown-ESC', this._escHandler);
                }
            } catch (keyErr) {
                console.warn('[ErrorManager] Failed to setup keyboard handler:', keyErr);
            }

            // Setup cleanup handlers safely
            try {
                if (scene.events) {
                    scene.events.once('shutdown', () => {
                        try {
                            this.hide();
                        } catch (shutdownErr) {
                            console.warn('[ErrorManager] Error during scene shutdown:', shutdownErr);
                        }
                    });
                    
                    scene.events.once('destroy', () => {
                        try {
                            this.hide();
                        } catch (destroyErr) {
                            console.warn('[ErrorManager] Error during scene destroy:', destroyErr);
                        }
                    });
                }
            } catch (eventErr) {
                console.warn('[ErrorManager] Failed to setup scene event handlers:', eventErr);
            }
        } catch (e) {
            console.error('[ErrorManager] displayError failed:', e);
            // Continue gracefully - error is at least logged to console
        }
    }

    /**
     * Get configuration for error type
     * @param {string} errorType
     * @returns {object}
     */
    getErrorConfig(errorType) {
        switch (errorType) {
            case 'syntax':
                return { title: 'SYNTAX ERROR', color: 0xff4444, hex: '#ff4444' };
            case 'type':
                return { title: 'TYPE ERROR', color: 0xff6666, hex: '#ff6666' };
            case 'reference':
                return { title: 'REFERENCE ERROR', color: 0xff8888, hex: '#ff8888' };
            case 'range':
                return { title: 'RANGE ERROR', color: 0xffaa99, hex: '#ffaa99' };
            case 'error':
            default:
                return { title: 'ERROR', color: 0xff4444, hex: '#ff4444' };
        }
    }

    /**
     * Fade out error display
     */
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
                    duration: 250,
                    onComplete: () => {
                        try {
                            this.hide();
                        } catch (completeErr) {
                            console.warn('[ErrorManager] Error during tween complete:', completeErr);
                            this.hide();
                        }
                    }
                });
            } else {
                this.hide();
            }
        } catch (e) {
            console.warn('[ErrorManager] fadeOut failed:', e);
            try {
                this.hide();
            } catch (hideErr) {
                console.warn('[ErrorManager] Also failed to hide during fadeOut error:', hideErr);
            }
        }
    }

    /**
     * Hide error display and clean up
     */
    hide() {
        try {
            // Safely remove keyboard handler
            try {
                if (this._scene && this._scene.input && typeof this._scene.input.keyboard === 'object' && this._escHandler) {
                    if (typeof this._scene.input.keyboard.off === 'function') {
                        this._scene.input.keyboard.off('keydown-ESC', this._escHandler);
                    }
                    this._escHandler = null;
                }
            } catch (keyboardErr) {
                console.warn('[ErrorManager] Error removing keyboard handler:', keyboardErr);
            }

            // Safely destroy container
            try {
                if (this._container) {
                    if (typeof this._container.destroy === 'function') {
                        this._container.destroy(true);
                    }
                    this._container = null;
                }
            } catch (containerErr) {
                console.warn('[ErrorManager] Error destroying container:', containerErr);
                this._container = null;
            }

            this._scene = null;
        } catch (e) {
            console.warn('[ErrorManager] hide failed:', e);
            // Force cleanup on error
            this._container = null;
            this._scene = null;
            this._escHandler = null;
        }
    }

    /**
     * Get all logged errors
     * @returns {array}
     */
    getErrors() {
        return this.errors;
    }

    /**
     * Clear error history
     */
    clearErrors() {
        this.errors = [];
    }
}

const ErrorHandler = new ErrorManager();
export default ErrorHandler;