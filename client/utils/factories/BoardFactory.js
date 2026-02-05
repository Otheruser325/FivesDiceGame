import { DEBUG_MODE } from '../DebugManager.js';

/**
 * Grid/bootstrap helpers that attach board state and coordinate helpers to a scene.
 */
export default class BoardFactory {
  /**
   * Sets up a grid on the given scene and injects helper functions:
   * - scene.getTileXY(row, col)
   * - scene.worldToGrid(x, y) -> { row, col }
   * - scene.TILE_SIZE, scene.GRID_OFFSET_X, scene.GRID_OFFSET_Y, scene.GRID_ROWS, scene.GRID_COLS
   *
   * Usage: BoardFactory.setupGrid(this);
   *
   * @param {Object} scene - Phaser scene to receive grid helpers/state
   * @param {Object} [options] - Grid configuration
   * @param {number} [options.rows=5] - Number of rows
   * @param {number} [options.cols=9] - Number of columns
   * @param {number} [options.tileSize=60] - Tile size in pixels
   * @param {number} [options.offsetX=300] - Grid origin X
   * @param {number} [options.offsetY=150] - Grid origin Y
   * @param {number} [options.cellSize=50] - Visual cell size (rect overlay)
   * @returns {Object|undefined} The scene (for chaining) or undefined if no scene provided
   */
  static setupGrid(scene, {
    rows = 5,
    cols = 9,
    tileSize = 60,
    offsetX = 300,
    offsetY = 150,
    cellSize = 50
  } = {}) {
    if (!scene) return;

    scene.GRID_ROWS = rows;
    scene.GRID_COLS = cols;
    scene.TILE_SIZE = tileSize;
    scene.GRID_OFFSET_X = offsetX;
    scene.GRID_OFFSET_Y = offsetY;
    scene.CELL_SIZE = cellSize;
	  scene.UNIT_Y_OFFSET = -30;

    // build grid structure
    scene.grid = [];
    for (let r = 0; r < rows; r++) {
      scene.grid[r] = [];
      for (let c = 0; c < cols; c++) {
        scene.grid[r][c] = { sprite: null, unit: null };
      }
    }

    // build puddle grid (per-cell lists)
    scene.puddles = [];
    for (let r = 0; r < rows; r++) {
      scene.puddles[r] = [];
      for (let c = 0; c < cols; c++) {
        scene.puddles[r][c] = [];
      }
    }

    // world position of tile center
    scene.getTileXY = function (row, col) {
      const tileSize = this.TILE_SIZE ?? (this._tileSize ?? 60);
      const offsetX = (this.GRID_OFFSET_X ?? this.offsetX ?? (this._gridOffsetX ?? 300));
      const offsetY = (this.GRID_OFFSET_Y ?? this.offsetY ?? (this._gridOffsetY ?? 150));

      const x = offsetX + (Number(col) || 0) * tileSize;
      const y = offsetY + (Number(row) || 0) * tileSize;
      return { x, y };
    };

    // convert world coords -> grid indices (returns nearest)
    scene.worldToGrid = function (x, y) {
      const col = Math.floor((x - scene.GRID_OFFSET_X + scene.TILE_SIZE/2) / scene.TILE_SIZE);
      const row = Math.floor((y - scene.GRID_OFFSET_Y + scene.TILE_SIZE/2) / scene.TILE_SIZE);
      return { row, col };
    };

    // Helper to draw the visual board rectangles if scene wants it.
    scene.drawBoardVisual = function () {
      if (!scene.add) return;
      if (scene.__boardCells) {
        scene.__boardCells.forEach(c => c.destroy());
      }
      scene.__boardCells = [];

      // compute centre column index
      const center = Math.floor(scene.GRID_COLS / 2);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let color = '#ffffff';
          if (c < center) color = '#6666ff';
          else if (c > center) color = '#ff6666';
          else color = '#66ff66';

          const { x, y } = scene.getTileXY(r, c);
          const rect = scene.add.rectangle(x, y, cellSize, cellSize, Phaser.Display.Color.HexStringToColor(color).color)
            .setStrokeStyle(2, 0x000000);

          rect.setInteractive();
          scene.__boardCells.push(rect);
        }
      }
    };

    return scene;
  }
}
