let OnlineSocket = null;

export function getSocket() {
    // offline mode
    if (typeof io !== "function") {
        console.warn("⚠ Socket.io not available — running offline.");
        return {
            connected: false,
            on() {},
            once() {},
            emit() {},
            off() {}
        };
    }

    // already created
    if (OnlineSocket) return OnlineSocket;

    // create
    OnlineSocket = io("/", { autoConnect: true });

    OnlineSocket.on("connect", async () => {
        try {
            const resp = await fetch("/auth/me", { credentials: "include" });
            const data = await resp.json();

            if (data?.ok && data.user) {
                OnlineSocket.emit("auth-user", data.user);
                console.log("Authenticated socket as", data.user);
            }
        } catch (e) {
            console.warn("Socket auth error:", e);
        }
    });

    return OnlineSocket;
}