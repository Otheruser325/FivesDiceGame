export const GAME_MODES = Object.freeze({
  CLASSIC: 'classic',
  COMBANITY: 'combanity',
  MULTIPLEX: 'multiplex'
});

export function isDiceathonConfig(config = {}) {
  const eventMode = String(config.eventMode ?? config.eventType ?? config.eventKey ?? '').trim().toLowerCase();
  return !!config.diceathon || eventMode === 'diceathon';
}

export function normalizeGameMode(gameMode, combos = false, multiplex = false) {
  const normalized = String(gameMode || '').trim().toLowerCase();
  if (normalized === GAME_MODES.COMBANITY || normalized === GAME_MODES.MULTIPLEX) {
    return normalized;
  }
  if (normalized === GAME_MODES.CLASSIC) {
    if (multiplex && !combos) return GAME_MODES.MULTIPLEX;
    if (combos) return GAME_MODES.COMBANITY;
    return normalized;
  }
  if (multiplex && !combos) return GAME_MODES.MULTIPLEX;
  return combos ? GAME_MODES.COMBANITY : GAME_MODES.CLASSIC;
}

export function getRuleFlags(gameMode, {
  combos = false,
  multiplex = false,
  allowCombined = false
} = {}) {
  const normalizedGameMode = normalizeGameMode(gameMode, combos, multiplex);

  return {
    gameMode: normalizedGameMode,
    combos: normalizedGameMode === GAME_MODES.COMBANITY || (allowCombined && !!combos),
    multiplex: normalizedGameMode === GAME_MODES.MULTIPLEX || (allowCombined && !!multiplex)
  };
}

export function isCombanityMode(gameMode, combos = false, multiplex = false) {
  return normalizeGameMode(gameMode, combos, multiplex) === GAME_MODES.COMBANITY;
}

export function isMultiplexMode(gameMode, combos = false, multiplex = false) {
  return normalizeGameMode(gameMode, combos, multiplex) === GAME_MODES.MULTIPLEX;
}

export function normalizeTeams(teams = [], playerCount = 2) {
  const safeCount = Math.min(6, Math.max(2, Number(playerCount) || 2));
  return Array.from({ length: safeCount }, (_, index) => {
    const team = teams[index];
    if (team === 'red' || team === 'blue') return team;
    return index % 2 === 0 ? 'blue' : 'red';
  });
}

export function buildNormalizedRuleConfig(config = {}) {
  const players = Math.min(6, Math.max(2, Number(config.players) || 2));
  const rounds = Math.min(30, Math.max(5, Number(config.rounds) || 20));
  const allowCombined = !!config.allowCombinedModes || isDiceathonConfig(config);
  const rules = getRuleFlags(config.gameMode ?? config.gamemode, {
    combos: config.combos,
    multiplex: config.multiplex,
    allowCombined
  });
  const teamsEnabled = !!config.teamsEnabled;

  return {
    players,
    rounds,
    gameMode: rules.gameMode,
    combos: rules.combos,
    multiplex: rules.multiplex,
    teamsEnabled,
    teams: teamsEnabled ? normalizeTeams(config.teams, players) : []
  };
}
