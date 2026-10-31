// Completion page shown in the OAuth popup. It hands the signed-in user to the
// opener and waits for an acknowledgement before closing. If the opener cannot
// be reached (closed, blocked, or the message was dropped), it navigates back to
// the game client so the login still lands instead of leaving a dead popup.
export function buildOAuthPopupCompletionPage(payload, openerOrigin) {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c');
  const serializedOpenerOrigin = JSON.stringify(openerOrigin || '');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>OAuth Complete</title>
  </head>
  <body>
    <p>Completing sign in...</p>
    <script>
      (function () {
        var payload = ${serializedPayload};
        var openerOrigin = ${serializedOpenerOrigin};
        var finished = false;

        function closeWindow() {
          document.body.textContent = 'Sign in complete. You can close this window.';
          try { window.close(); } catch (e) {}
        }

        function returnToGame() {
          if (finished) return;
          finished = true;
          try {
            if (window.opener && !window.opener.closed && payload.redirectUrl) {
              window.opener.location.replace(payload.redirectUrl);
              closeWindow();
              return;
            }
          } catch (e) {}
          if (payload.redirectUrl) {
            window.location.replace(payload.redirectUrl);
            return;
          }
          closeWindow();
        }

        if (!openerOrigin || !window.opener || window.opener.closed) {
          returnToGame();
          return;
        }

        window.addEventListener('message', function (event) {
          if (!event || event.origin !== openerOrigin) return;
          if (event.source !== window.opener) return;
          var data = event.data;
          if (!data || data.type !== 'fives-oauth-ack') return;
          if (finished) return;
          finished = true;
          closeWindow();
        });

        try {
          window.opener.postMessage(payload, openerOrigin);
        } catch (e) {
          returnToGame();
          return;
        }

        setTimeout(returnToGame, 3000);
      })();
    </script>
  </body>
</html>`;
}
