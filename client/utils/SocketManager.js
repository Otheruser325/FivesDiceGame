export let OnlineSocket = io("/", { autoConnect: true }) ?? null;

export function getSocket() {
  // If io doesn't exist (server unavailable or script not loaded)
  if (typeof io !== "function") {
    console.warn("⚠ Socket.io not available — running in offline mode.");

    // Minimal mock socket so the game doesn't crash
    return {
      connected: false,
      on() {},
      emit() {},
      off() {},
    };
  }

  // If already initialised, return the existing instance
  if (OnlineSocket) return OnlineSocket;

  // Otherwise create the real socket
  OnlineSocket = io("/", { autoConnect: true });

  OnlineSocket.on("connect", async () => {
    try {
      const resp = await fetch("/auth/me", { credentials: "include" });
      const data = await resp.json();

      if (data?.ok && data.user) {
        OnlineSocket.emit("auth-user", data.user);
        console.log("Authenticated socket as", data.user);
      } else {
        console.log("No session user found.");
      }
    } catch (err) {
      console.warn("Auth error:", err);
    }
  });

  return OnlineSocket;
}