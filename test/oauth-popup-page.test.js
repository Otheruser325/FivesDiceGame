import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOAuthPopupCompletionPage } from '../server/oauthPopupPage.js';

const REDIRECT = 'https://play.fivesdicegame.com/?auth=success&provider=discord';

test('completion page hands the payload to the opener and waits for an acknowledgement', () => {
  const html = buildOAuthPopupCompletionPage(
    { type: 'fives-oauth-success', provider: 'discord', user: { id: 'u1', name: 'Ada' }, redirectUrl: REDIRECT },
    'https://play.fivesdicegame.com'
  );

  assert.match(html, /window\.opener\.postMessage\(payload, openerOrigin\)/);
  assert.match(html, /fives-oauth-ack/);
  assert.match(html, /setTimeout\(returnToGame, 3000\)/);
  assert.ok(html.includes(JSON.stringify(REDIRECT)), 'redirect target missing');
  assert.ok(!html.includes("postMessage(payload, '*')"), 'wildcard target origin');
});

test('completion page falls back to the game client when no opener is available', () => {
  const html = buildOAuthPopupCompletionPage(
    { type: 'fives-oauth-success', redirectUrl: REDIRECT },
    'https://play.fivesdicegame.com'
  );

  assert.match(html, /window\.opener\.location\.replace\(payload\.redirectUrl\)/);
  assert.match(html, /window\.location\.replace\(payload\.redirectUrl\)/);
  assert.match(html, /if \(!openerOrigin \|\| !window\.opener \|\| window\.opener\.closed\)/);
});

test('completion page cannot be broken out of with a crafted display name', () => {
  const html = buildOAuthPopupCompletionPage(
    {
      type: 'fives-oauth-success',
      user: { id: 'u1', name: '</script><script>alert(1)</script>' },
      redirectUrl: REDIRECT
    },
    'https://play.fivesdicegame.com'
  );

  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'raw script payload present');
  assert.ok(html.includes('\\u003c/script'), 'expected escaped closing tag');
});

test('completion page targets only the allowed opener origin', () => {
  const html = buildOAuthPopupCompletionPage(
    { type: 'fives-oauth-success', redirectUrl: REDIRECT },
    'https://play.fivesdicegame.com'
  );

  assert.ok(html.includes('var openerOrigin = "https://play.fivesdicegame.com"'));
  assert.ok(!html.includes('postMessage(payload, "*")'));
});
