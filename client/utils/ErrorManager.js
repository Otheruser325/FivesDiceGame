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
        });

        // Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('[ErrorManager] Unhandled promise rejection:', event.reason);
            const message = event.reason instanceof Error 
                ? event.reason.message 
                : String(event.reason);
            this.logError(new Error(`Unhandled Promise: ${message}`));
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
     * Log an error and display it as a Phaser popup
     * @param {Error|string} error
     */
    logError(error) {
        try {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorType = this.getErrorType(error);
            
            this.errors.push({ message: errorMessage, type: errorType, timestamp: Date.now() });
            console.error(`[ErrorManager] ${errorType.toUpperCase()}: ${errorMessage}`);
            
            if (this._scene && this._scene.isActive && this._scene.isActive()) {
                this.displayError(this._scene, errorMessage, errorType);
            }
        } catch (e) {
            // Failsafe: if logging itself fails, log to console only
            console.error('[ErrorManager] Failed to log error:', e);
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
            if (!scene || !scene.add || !scene.cameras) return;

            this.hide();
            this._scene = scene;

            const cam = scene.cameras.main;
            if (!cam) return;

            const cx = cam.centerX;
            const cy = cam.centerY;

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
                fontFamily: 'Orbitron, Arial',
                color: config.hex
        }).setOrigin(0.5);

            // Message
            const bodyText = scene.add.text(cx, cy - 10, displayMessage, {
                fontSize: 18,
                fontFamily: 'Orbitron, Arial',
                color: '#ffffff',
                align: 'center',
                wordWrap: { width: width - 48 }
            }).setOrigin(0.5);

            // Close button
            const closeBtn = scene.add.text(cx, cy + height / 2 - 32, 'Close', {
                fontSize: 20,
                fontFamily: 'Orbitron, Arial',
                color: '#ff6666'
            })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.fadeOut());

            const container = scene.add.container(0, 0, [
                blocker,
                panel,
                titleText,
                bodyText,
                closeBtn
            ]);

            container.setDepth(10000);
            this._container = container;
            this._escHandler = (event) => {
                event.stopPropagation();
                this.fadeOut();
            };

            scene.input.keyboard.on('keydown-ESC', this._escHandler);
            scene.events.once('shutdown', () => this.hide());
            scene.events.once('destroy', () => this.hide());
        } catch (e) {
            console.error('[ErrorManager] displayError failed:', e);
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

            if (this._scene.tweens) {
                this._scene.tweens.add({
                    targets: this._container,
                    alpha: 0,
                    duration: 250,
                    onComplete: () => this.hide()
                });
            } else {
                this.hide();
            }
        } catch (e) {
            console.error('[ErrorManager] fadeOut failed:', e);
            this.hide();
        }
    }

    /**
     * Hide error display and clean up
     */
    hide() {
        try {
            if (this._scene && this._scene.input && this._scene.input.keyboard && this._escHandler) {
                this._scene.input.keyboard.off('keydown-ESC', this._escHandler);
                this._escHandler = null;
            }

            if (this._container) {
                this._container.destroy(true);
                this._container = null;
            }

            this._scene = null;
        } catch (e) {
            console.error('[ErrorManager] hide failed:', e);
            this._container = null;
            this._scene = null;
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