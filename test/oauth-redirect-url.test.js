import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeClientPath,
  resolveClientRedirect,
  isSameSiteOrigin
} from '../server/oauthRedirect.js';

test('the client return path must stay a plain same-origin path', () => {
  assert.equal(sanitizeClientPath('/'), '/');
  assert.equal(sanitizeClientPath('/FivesDiceGame/'), '/FivesDiceGame/');
  assert.equal(sanitizeClientPath('/play/index.html'), '/play/index.html');

  assert.equal(sanitizeClientPath('//evil.example'), null);
  assert.equal(sanitizeClientPath('https://evil.example'), null);
  assert.equal(sanitizeClientPath('/../etc/passwd'), null);
  assert.equal(sanitizeClientPath('/a?next=//evil.example'), null);
  assert.equal(sanitizeClientPath('/a#fragment'), null);
  assert.equal(sanitizeClientPath('/a\\b'), null);
  assert.equal(sanitizeClientPath('/a\u0000b'), null);
  assert.equal(sanitizeClientPath(`/${'a'.repeat(400)}`), null);
  assert.equal(sanitizeClientPath(null), null);
});

test('the return URL keeps the game path and never leaves its origin', () => {
  assert.equal(
    resolveClientRedirect('https://otheruser325.github.io', '/FivesDiceGame/'),
    'https://otheruser325.github.io/FivesDiceGame/'
  );
  assert.equal(
    resolveClientRedirect('https://play.fivesdicegame.com', '/'),
    'https://play.fivesdicegame.com/'
  );
  // A rejected path falls back to the bare origin, not to the attacker's URL.
  assert.equal(
    resolveClientRedirect('https://play.fivesdicegame.com', '//evil.example/steal'),
    'https://play.fivesdicegame.com/'
  );
  // Percent-encoded traversal is normalised by the URL parser inside the origin.
  assert.equal(
    new URL(resolveClientRedirect('https://play.fivesdicegame.com', '/%2e%2e/evil')).origin,
    'https://play.fivesdicegame.com'
  );
  assert.equal(resolveClientRedirect('not a url', '/'), null);
});

test('same-site clients are recognised, cross-site clients are not', () => {
  assert.equal(isSameSiteOrigin('https://play.fivesdicegame.com', 'api.fivesdicegame.com'), true);
  assert.equal(isSameSiteOrigin('https://fivesdicegame.com', 'https://api.fivesdicegame.com'), true);
  assert.equal(isSameSiteOrigin('https://www.fivesdicegame.com', 'api.fivesdicegame.com'), true);
  assert.equal(isSameSiteOrigin('https://play.fivesdicegame.com', 'localhost'), false);
  assert.equal(isSameSiteOrigin('https://fivesdicegame.vercel.app', 'fivesapi.onrender.com'), false);
  assert.equal(isSameSiteOrigin('https://otheruser325.github.io', 'fivesapi.onrender.com'), false);
  // A lookalike suffix is not the same site.
  assert.equal(isSameSiteOrigin('https://evilfivesdicegame.com', 'api.fivesdicegame.com'), false);
  assert.equal(isSameSiteOrigin('', 'api.fivesdicegame.com'), false);
});
