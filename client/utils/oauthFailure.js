// Classifies a failed OAuth delivery so the player sees the real outcome instead
// of the browser's `AggregateError: All promises were rejected`. A completed
// sign-in may still have saved the session, so an aggregate rejection is never
// reported as a network failure.
export function oauthFailureReasons(error) {
  if (Array.isArray(error?.errors)) return error.errors.filter(Boolean);
  return error ? [error] : [];
}

export function classifyOAuthFailure(error) {
  const reasons = oauthFailureReasons(error);

  // A terminal failure published by the callback (expired state, provider
  // error) is authoritative and carries the message the player should see.
  const reported = reasons.find((reason) => reason?.oauthFailure && !reason?.retryable);
  if (reported) {
    return { kind: 'reported', message: String(reported.message || '') };
  }

  // Our own throttle refuses to start or report an attempt; it does not prove
  // that sign-in failed. The session check may still find a login that an
  // earlier attempt completed, so this is retryable rather than terminal.
  const retryable = reasons.find((reason) => reason?.retryable || reason?.code === 'rate_limited');
  if (retryable) {
    return { kind: 'rate_limited', message: String(retryable.message || '') };
  }

  // Promise.any keeps every rejection and only reports the last one as the
  // error message. Scan all of them so a closed popup or a timeout is detected
  // regardless of which strategy settled first.
  const text = reasons
    .map((reason) => String(reason?.message || ''))
    .join(' | ')
    .toLowerCase();

  if (text.includes('popup closed')) return { kind: 'cancelled', message: '' };
  if (text.includes('timed out')) return { kind: 'timeout', message: '' };

  // Every delivery path failed. Some fail by design (Google severs the opener),
  // so this is not a network error and must not be presented as one.
  if (error?.name === 'AggregateError' || Array.isArray(error?.errors)) {
    return { kind: 'unconfirmed', message: '' };
  }

  return { kind: 'network', message: String(error?.message || '') };
}
