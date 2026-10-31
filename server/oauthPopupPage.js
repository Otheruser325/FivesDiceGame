// Completion page shown in the OAuth popup. It hands the signed-in user to the
// opener and waits for an acknowledgement before closing.
//
// It deliberately never navigates anywhere. When a provider severs the opener
// (Google sends Cross-Origin-Opener-Policy: same-origin), navigating this window
// to the game URL would create a second game tab while the tab the player was
// using stays signed out. The game tab instead claims the login over HTTP, so
// this page only has to deliver the message when it can and then close.
export function buildOAuthPopupCompletionPage(payload, openerOrigin) {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const serializedOpenerOrigin = JSON.stringify(openerOrigin || '');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Sign in complete</title>
  </head>
  <body>
    <p id="status">Completing sign in...</p>
    <script>
      (function () {
        var payload = ${serializedPayload};
        var openerOrigin = ${serializedOpenerOrigin};
        var status = document.getElementById('status');
        var finished = false;
        var attempts = 0;
        var retryId = null;
        var failed = !!(payload && payload.type === 'fives-oauth-error');
        var DONE_TEXT = failed
          ? 'Sign in failed. You can close this window.'
          : 'Sign in complete. You can close this window.';
        var RETURN_TEXT = failed
          ? 'Sign in failed. Return to the game tab.'
          : 'Sign in complete. Return to the game tab.';

        function stopRetrying() {
          if (retryId) {
            clearInterval(retryId);
            retryId = null;
          }
        }

        function finish(message) {
          if (finished) return;
          finished = true;
          stopRetrying();
          status.textContent = message;
          try { window.close(); } catch (e) {}
        }

        function openerAvailable() {
          return !!(openerOrigin && window.opener && !window.opener.closed);
        }

        function send() {
          if (finished) return;
          if (!openerAvailable()) {
            // The browsing context group was separated (COOP) or the game tab is
            // gone. The game tab picks the result up from the server; never load
            // the game here.
            finish(RETURN_TEXT);
            return;
          }
          attempts += 1;
          try {
            window.opener.postMessage(payload, openerOrigin);
          } catch (e) {
            finish(RETURN_TEXT);
            return;
          }
          if (attempts >= 30) {
            stopRetrying();
            status.textContent = DONE_TEXT;
          }
        }

        function sendNow() {
          attempts = 0;
          if (!retryId && !finished) retryId = setInterval(send, 400);
          send();
        }

        window.addEventListener('message', function (event) {
          if (!event || event.origin !== openerOrigin) return;
          if (!window.opener || event.source !== window.opener) return;
          var data = event.data;
          if (!data || typeof data !== 'object') return;
          if (data.type === 'fives-oauth-ack') {
            finish(DONE_TEXT);
          } else if (data.type === 'fives-oauth-ready') {
            sendNow();
          }
        });

        // Repeated sends cover the game tab attaching its listener after the
        // popup already loaded; a single postMessage used to be dropped.
        sendNow();
        setTimeout(function () {
          if (!finished && !openerAvailable()) finish(RETURN_TEXT);
        }, 1500);
      })();
    </script>
  </body>
</html>`;
}
