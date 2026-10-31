import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOAuthFailure } from '../client/utils/oauthFailure.js';

function aggregate(...reasons) {
  return new AggregateError(reasons, 'All promises were rejected');
}

test('an aggregate rejection is never reported as a network failure', () => {
  const err = aggregate(new Error('OAuth login failed'), new Error('OAuth login failed'));

  assert.deepEqual(classifyOAuthFailure(err), { kind: 'unconfirmed', message: '' });
});

test('a closed popup is recognised from any reason, not just the first', () => {
  const err = aggregate(
    new Error('OAuth handoff unavailable'),
    new Error('OAuth login timed out'),
    new Error('OAuth popup closed before login finished')
  );

  assert.equal(classifyOAuthFailure(err).kind, 'cancelled');
});

test('timeouts are reported as a timeout, not a network error', () => {
  const err = aggregate(new Error('OAuth login timed out'), new Error('OAuth login timed out'));

  assert.equal(classifyOAuthFailure(err).kind, 'timeout');
});

test('a provider failure wins over the aggregate wrapper', () => {
  const failure = new Error('Sign in session expired. Please try again.');
  failure.oauthFailure = true;
  const err = aggregate(new Error('OAuth login failed'), failure);

  assert.deepEqual(classifyOAuthFailure(err), {
    kind: 'reported',
    message: 'Sign in session expired. Please try again.'
  });
});

test('a direct request error keeps its message for the network path', () => {
  assert.deepEqual(classifyOAuthFailure(new TypeError('fetch failed')), {
    kind: 'network',
    message: 'fetch failed'
  });
});
