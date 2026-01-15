class AlertManager {
  constructor() {
    this._scene = null;
    this._container = null;
    this._timer = null;
    this._escHandler = null;
  }

  /**
   * Show a modal alert
   * @param {Phaser.Scene} scene
   * @param {string} message
   * @param {'warning'|'error'|'success'|'checking'} type
   */
  show(scene, message, type = 'warning') {
    if (!scene || !scene.add) return;

    this.hide();
    this._scene = scene;

    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const cy = cam.centerY;

    const config = this.getTypeConfig(type);

    const width = 560;
    const height = 200;

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
    const bodyText = scene.add.text(cx, cy, message, {
      fontSize: 20,
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
  }

  getTypeConfig(type) {
    switch (type) {
      case 'error':
        return { title: 'ERROR', color: 0xff4444, hex: '#ff4444' };
      case 'success':
        return { title: 'SUCCESS', color: 0x66ff66, hex: '#66ff66' };
      case 'checking':
        return { title: 'CHECKING', color: 0x66aaff, hex: '#66aaff' };
      case 'warning':
      default:
        return { title: 'WARNING', color: 0xffff66, hex: '#ffff66' };
    }
  }

  fadeOut() {
    if (!this._scene || !this._container) return;

    this._scene.tweens.add({
      targets: this._container,
      alpha: 0,
      duration: 250,
      onComplete: () => this.hide()
    });
  }

  hide() {
    if (this._scene && this._escHandler) {
      this._scene.input.keyboard.off('keydown-ESC', this._escHandler);
      this._escHandler = null;
    }

    if (this._timer) {
      this._timer.remove();
      this._timer = null;
    }

    if (this._container) {
      this._container.destroy(true);
      this._container = null;
    }

    this._scene = null;
  }
}

const GlobalAlerts = new AlertManager();
export default GlobalAlerts;