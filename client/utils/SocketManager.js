export const OnlineSocket = io("/", { autoConnect: true });

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