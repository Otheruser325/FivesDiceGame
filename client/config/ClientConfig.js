/**
 * FIVES DICE GAME - CLIENT CONFIGURATION
 * 
 * This file contains all configurable settings for the game client.
 * It supports both development and production environments.
 */

const CONFIG = {
  // ==========================================
  // ENVIRONMENT & DEPLOYMENT
  // ==========================================
  
  environment: 'development',  // 'development' | 'production'
  
  // Server endpoints
  servers: {
    production: {
      primary: 'https://api.fivesdicegame.com',      // Main API server
      fallback: 'https://fivesapi.vercel.app'        // Vercel fallback
    },
    development: {
      primary: 'http://localhost:8080',
      fallbacks: [
        'http://127.0.0.1:8080',
        'http://localhost:8081',
        'http://localhost:8082'
      ]
    }
  },

  // ==========================================
  // SOCKET.IO CONFIGURATION
  // ==========================================
  
  socket: {
    // Connection behavior
    reconnection: true,
    reconnectionDelay: 300,
    reconnectionDelayMax: 8000,
    reconnectionAttempts: 15,
    
    // Timeouts
    connectTimeout: 15000,
    pingInterval: 20000,
    pingTimeout: 60000,
    
    // Transports (order matters)
    transports: ['websocket', 'polling'],
    transports_vercel: ['polling'],  // Vercel requires polling
    
    // Other options
    upgrade: true,
    rememberUpgrade: true,
    withCredentials: true,
    path: '/socket.io/'
  },

  // ==========================================
  // GAME SETTINGS
  // ==========================================
  
  game: {
    // Default game configuration
    defaults: {
      players: 2,
      rounds: 20,
      combos: false,
      teamsEnabled: false
    },
    
    // Game limits
    minPlayers: 2,
    maxPlayers: 6,
    minRounds: 5,
    maxRounds: 100,
    
    // Turn timing (seconds)
    turnTimeoutSeconds: 30,
    
    // Lobby settings
    lobbyCodeLength: 4,
    lobbyExpirationMs: 3600000  // 1 hour
  },

  // ==========================================
  // UI/UX SETTINGS
  // ==========================================
  
  ui: {
    // Theme colors
    colors: {
      primary: '#66aaff',
      secondary: '#ffaa44',
      success: '#66ff99',
      danger: '#ff6666',
      warning: '#ffff66'
    },
    
    // Animation settings
    animation: {
      diceRollDuration: 500,
      scoreUpdateDuration: 300,
      transitionDuration: 250
    },
    
    // Notification settings
    notifications: {
      duration: 3000,
      maxVisible: 3
    }
  },

  // ==========================================
  // AUDIO SETTINGS
  // ==========================================
  
  audio: {
    enabled: true,
    volume: 0.7,
    muted: false,
    
    sounds: {
      diceRoll: 'dice-roll',
      scoreUp: 'score-up',
      turnEnd: 'turn-end',
      gameStart: 'game-start',
      gameEnd: 'game-end',
      buttonClick: 'click',
      error: 'error'
    }
  },

  // ==========================================
  // FEATURES
  // ==========================================
  
  features: {
    onlineMultiplayer: true,
    localMultiplayer: true,
    tournaments: false,
    profiles: false,
    stats: false,
    spectator: false,
    voiceChat: false,
    customSkins: false
  },

  // ==========================================
  // DEBUGGING & LOGGING
  // ==========================================
  
  debug: {
    enabled: false,  // Set to true for verbose logging
    logSocket: false,
    logScenes: false,
    logGame: false,
    logNetwork: false
  },

  // ==========================================
  // PERFORMANCE
  // ==========================================
  
  performance: {
    // Physics settings
    physics: {
      fps: 60,
      debug: false
    },
    
    // Render settings
    render: {
      pixelArt: true,
      antialias: true,
      canvas: true,
      maxLights: 10
    },
    
    // Optimization
    autoCenter: true,
    transparent: false,
    scale: {
      mode: 'FIT',
      autoCenter: 'CENTER_BOTH'
    }
  }
};

/**
 * Get the appropriate server URL based on environment
 * @returns {string} The server URL
 */
export function getServerUrl() {
  const env = CONFIG.environment || 'production';
  const config = CONFIG.servers[env];
  
  if (env === 'production') {
    return config.primary;
  } else {
    return config.primary;  // Use primary in development
  }
}

/**
 * Get Socket.io configuration based on server
 * @param {string} serverUrl - The server URL
 * @returns {object} Socket.io options
 */
export function getSocketIOConfig(serverUrl) {
  const config = { ...CONFIG.socket };
  
  // Use polling-only for Vercel
  if (serverUrl.includes('vercel.app')) {
    config.transports = CONFIG.socket.transports_vercel;
  }
  
  return config;
}

/**
 * Enable debug mode
 */
export function enableDebug() {
  CONFIG.debug.enabled = true;
  CONFIG.debug.logSocket = true;
  CONFIG.debug.logScenes = true;
  CONFIG.debug.logGame = true;
  CONFIG.debug.logNetwork = true;
  console.log('🐛 Debug mode enabled');
}

/**
 * Check if a feature is enabled
 * @param {string} featureName - The feature name
 * @returns {boolean} Whether the feature is enabled
 */
export function isFeatureEnabled(featureName) {
  return CONFIG.features[featureName] || false;
}

export default CONFIG;
