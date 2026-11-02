import { randomInt } from 'node:crypto';

const DAY = 24 * 60 * 60 * 1000;
const FIRST_START = Date.UTC(2026, 9, 31);
const INTERVAL = 14 * DAY;
const DURATION = 7 * DAY;

export function diceathonSchedule(now = Date.now()) {
  let start = FIRST_START;
  if (now >= FIRST_START) {
    start += Math.floor((now - FIRST_START) / INTERVAL) * INTERVAL;
    if (now >= start + DURATION) start += INTERVAL;
  }
  const end = start + DURATION;
  const active = now >= start && now < end;
  return {
    visible: active || (now >= start - DAY && now < start),
    active,
    startsAt: start,
    endsAt: end,
    nextChangeAt: active ? end : now < start - DAY ? start - DAY : start
  };
}

export function randomDiceathonConfig(pick = randomInt) {
  const mode = pick(4);
  const options = [
    { gameMode: 'classic', combos: false, multiplex: false, eventName: 'Diceathon: Classic' },
    { gameMode: 'combanity', combos: true, multiplex: false, eventName: 'Diceathon: Combanity' },
    { gameMode: 'multiplex', combos: false, multiplex: true, eventName: 'Diceathon: Multiplex' },
    { gameMode: 'combanity', combos: true, multiplex: true, eventName: 'Diceathon: Combanity + Multiplex' }
  ];
  return { ...options[mode], eventMode: 'diceathon', players: 6, rounds: 20, teamsEnabled: false };
}
