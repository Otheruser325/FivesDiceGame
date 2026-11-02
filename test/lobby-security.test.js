import test from 'node:test';
import assert from 'node:assert/strict';
import LobbyManager from '../server/lobbyManager.js';

function setup(count = 3) {
  const manager = Object.create(LobbyManager.prototype);
  const broadcasts = [];
  manager.io = {
    to: () => ({ emit: (name, data) => broadcasts.push({ name, data }) }),
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() }
  };
  manager.load = async () => {};
  manager.save = async () => {};
  manager._updateGameStats = async () => {};
  const players = Array.from({ length: count }, (_, i) => ({
    id: `u${i}`, name: `Player ${i}`, score: 0, comboStats: {}, left: false, ready: true
  }));
  const lobby = { code: 'ABCDE', hostUserId: 'u0', players: players.map(p => ({ ...p })), config: { players: count, rounds: 5 } };
  const game = { code: 'ABCDE', players, currentIndex: 0, round: 1, totalRounds: 5, config: lobby.config, timeLimitSeconds: 60, turnTimer: null, rollInProgress: false };
  manager.lobbies = { ABCDE: lobby };
  manager.activeGames = { ABCDE: game };
  const sockets = players.map((p, i) => {
    const handlers = new Map();
    const sent = [];
    const socket = {
      id: `s${i}`, connected: true, data: {}, request: { user: { id: p.id, name: p.name, type: 'guest' } },
      rooms: new Set([`s${i}`, 'ABCDE']),
      on: (name, handler) => handlers.set(name, handler),
      emit: (name, data) => sent.push({ name, data }),
      leave: code => socket.rooms.delete(code), join: code => socket.rooms.add(code), handlers, sent
    };
    manager.io.sockets.sockets.set(socket.id, socket);
    return socket;
  });
  manager.io.sockets.adapter.rooms.set('ABCDE', new Set(sockets.map(s => s.id)));
  return { manager, game, lobby, sockets, broadcasts };
}

async function registerAll(state) {
  for (const socket of state.sockets) await state.manager.registerSocket(socket);
}

function cleanup(state) {
  if (state.game.turnTimer) clearTimeout(state.game.turnTimer);
}

test('only one server-authoritative result is scored per turn', async () => {
  const state = setup();
  await registerAll(state);
  const { manager, game, sockets, broadcasts } = state;
  manager.startTurn('ABCDE');
  const current = sockets[0];
  for (const name of ['player-roll', 'player-end-turn', 'player-timeout', 'team-changed']) current.handlers.get(name)(null);
  current.handlers.get('player-timeout')({ code: 'ABCDE' });
  current.handlers.get('player-timeout')({ code: 'ABCDE' });
  assert.equal(game.players[0].score, 0);
  current.handlers.get('player-roll')({ code: 'ABCDE' });
  current.handlers.get('player-roll')({ code: 'ABCDE' });
  await new Promise(resolve => setTimeout(resolve, 750));
  const score = game.players[0].score;
  assert.ok(score > 0);
  assert.equal(broadcasts.filter(e => e.name === 'turn-result').length, 1);
  current.handlers.get('player-roll')({ code: 'ABCDE' });
  manager.handleTimeout('ABCDE');
  assert.equal(game.players[0].score, score);
  cleanup(state);
});

test('an expired turn is scored once and cannot be rolled again', async () => {
  const state = setup();
  await registerAll(state);
  state.manager.startTurn('ABCDE');
  state.game.turnExpiresAt = Date.now() - 1;
  state.manager.handleTimeout('ABCDE');
  const score = state.game.players[0].score;
  state.manager.handleTimeout('ABCDE');
  state.sockets[0].handlers.get('player-roll')({ code: 'ABCDE' });
  assert.ok(score > 0);
  assert.equal(state.game.players[0].score, score);
  assert.equal(state.broadcasts.filter(e => e.name === 'player-timeout').length, 1);
  cleanup(state);
});

test('a member cannot end a game; a non-current surrender preserves the turn', async () => {
  const state = setup();
  await registerAll(state);
  state.manager.startTurn('ABCDE');
  state.game.players[0].hasRolled = true;
  const timer = state.game.turnTimer;
  await state.sockets[1].handlers.get('game-finished')('ABCDE');
  assert.equal(state.sockets[1].sent.at(-1).data.reason, 'server_authoritative');
  await state.sockets[1].handlers.get('leave-lobby')('ABCDE');
  assert.equal(state.game.players[1].left, true);
  assert.equal(state.game.currentIndex, 0);
  assert.equal(state.game.players[0].hasRolled, true);
  assert.equal(state.game.turnTimer, timer);
  cleanup(state);
});

test('surrender during a pending roll advances before slow persistence and discards the roll', async () => {
  const state = setup(4);
  await registerAll(state);
  state.manager.startTurn('ABCDE');
  let release;
  state.manager.save = () => new Promise(resolve => { release = resolve; });
  state.sockets[0].handlers.get('player-roll')({ code: 'ABCDE' });
  const leaving = state.sockets[0].handlers.get('leave-lobby')('ABCDE');
  assert.equal(state.game.currentIndex, 1);
  assert.equal(state.game.players[0].left, true);
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(state.game.players[0].score, 0);
  assert.equal(state.broadcasts.filter(e => e.name === 'turn-result').length, 0);
  release();
  await leaving;
  cleanup(state);
});

test('concurrent surrenders do not advance past the surviving current player', async () => {
  const state = setup(4);
  await registerAll(state);
  state.manager.startTurn('ABCDE');
  await Promise.all([
    state.sockets[0].handlers.get('leave-lobby')('ABCDE'),
    state.sockets[2].handlers.get('leave-lobby')('ABCDE')
  ]);
  assert.equal(state.game.currentIndex, 1);
  assert.equal(state.game.players[0].left, true);
  assert.equal(state.game.players[2].left, true);
  assert.equal(state.game.turnStarted, true);
  cleanup(state);
});

test('disconnect of a second connection preserves the player, but explicit leave surrenders', async () => {
  const state = setup();
  await registerAll(state);
  const original = state.sockets[0];
  const other = { ...original, id: 'second', rooms: new Set(['second', 'ABCDE']) };
  other.leave = code => other.rooms.delete(code);
  state.manager.io.sockets.sockets.set(other.id, other);
  state.manager.io.sockets.adapter.rooms.get('ABCDE').add(other.id);
  state.manager.startTurn('ABCDE');
  await state.manager.removePlayerFromLobby('ABCDE', other, { disconnecting: true });
  assert.equal(state.game.players[0].left, false);
  other.rooms.add('ABCDE');
  await state.sockets[0].handlers.get('leave-lobby')('ABCDE');
  assert.equal(state.game.players[0].left, true);
  assert.equal(other.rooms.has('ABCDE'), false);
  assert.equal(state.game.currentIndex, 1);
  cleanup(state);
});

test('a surrendered player cannot rejoin an active game, and host transfer updates both field formats', async () => {
  const state = setup(4);
  state.lobby.hostuserid = 'u0';
  await registerAll(state);
  state.manager.startTurn('ABCDE');
  await state.sockets[0].handlers.get('leave-lobby')('ABCDE');
  assert.equal(state.lobby.hostuserid, 'u1');
  assert.equal(state.lobby.hostUserId, 'u1');
  await state.sockets[0].handlers.get('join-lobby')('ABCDE');
  assert.equal(state.sockets[0].sent.at(-1).data.reason, 'game_started');
  assert.equal(state.lobby.players[0].left, true);
  cleanup(state);
});

test('current player surrender advances once and two-player surrender finishes the game', async () => {
  const state = setup();
  await registerAll(state);
  state.manager.startTurn('ABCDE');
  await state.sockets[0].handlers.get('leave-lobby')('ABCDE');
  assert.equal(state.game.currentIndex, 1);
  assert.equal(state.game.players[0].left, true);
  await state.sockets[1].handlers.get('leave-lobby')('ABCDE');
  assert.equal(state.manager.activeGames.ABCDE, undefined);
  assert.equal(state.broadcasts.filter(e => e.name === 'game-finished').length, 1);
  cleanup(state);
});
