import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOAuthPopupCompletionPage } from '../server/oauthPopupPage.js';

const OPENER = 'https://play.fivesdicegame.com';
const NONCE = 'a'.repeat(32);

function page(payloadOverrides = {}) {
  return buildOAuthPopupCompletionPage(
    {
      type: 'fives-oauth-success',
      provider: 'google',
      user: { id: 'u1', name: 'Ada' },
      timestamp: Date.now(),
      ...payloadOverrides
    },
    OPENER
  );
}

test('completion page hands the payload to the opener and retries until acknowledged', () => {
  const html = page();

  assert.match(html, /window\.opener\.postMessage\(payload, openerOrigin\)/);
  assert.match(html, /fives-oauth-ack/);
  assert.match(html, /setInterval\(send, 400\)/);
  assert.ok(!html.includes("postMessage(payload, '*')"), 'wildcard target origin');
});

test('completion page never navigates itself or the opener into the game', () => {
  const html = page();

  // Navigating would turn the popup into a second game tab, or reload the
  // current tab with a URL the server invented.
  assert.ok(!html.includes('window.location.replace'), 'popup navigates itself');
  assert.ok(!html.includes('window.opener.location'), 'popup navigates the opener');
  assert.ok(!html.includes('location.assign'), 'popup assigns a location');
  assert.ok(!html.includes('redirectUrl'), 'completion page still receives a redirect target');
});

test('completion page closes and asks the player to return when the opener is gone', () => {
  const html = page();

  assert.match(html, /Sign in complete\. Return to the game tab\./);
  assert.match(html, /window\.opener\.closed/);
  assert.match(html, /window\.close\(\)/);
});

test('an error completion page reports the failure without navigating', () => {
  const html = buildOAuthPopupCompletionPage(
    { type: 'fives-oauth-error', provider: 'google', error: 'Google sign in was cancelled or failed.' },
    OPENER
  );

  assert.ok(html.includes('Sign in failed. Return to the game tab.'));
  assert.ok(html.includes('Sign in failed. You can close this window.'));
  assert.ok(!html.includes('window.location.replace'));
  assert.ok(!html.includes('window.opener.location'));
});

test('completion page cannot be broken out of with a crafted display name', () => {
  const html = page({ user: { id: 'u1', name: '</script><script>alert(1)</script>' } });

  assert.ok(!html.includes('</script><script>alert(1)</script>'), 'raw script payload present');
  assert.ok(html.includes('\\u003c/script'), 'expected escaped closing tag');
});

test('completion page targets only the allowed opener origin', () => {
  const html = page();

  assert.ok(html.includes(`var openerOrigin = "${OPENER}"`));
  assert.ok(!html.includes('postMessage(payload, "*")'));
  assert.ok(!html.includes(NONCE), 'the handoff secret must not be rendered into the popup');
});
