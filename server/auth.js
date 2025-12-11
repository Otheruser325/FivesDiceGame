import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import OAuth2Strategy from "passport-oauth2";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { loadUsers, saveUsers } from "./utils/userStorage.js";

export const router = express.Router();

// Ensure JSON parsing
router.use(express.json());

let USERS = await loadUsers(); // load from data/users.json

// PASSPORT SESSION
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  USERS = await loadUsers();
  done(null, USERS[id] || null);
});

// SAFE HELPER
function publicUser(u) {
  if (!u) return null;
  const { guestPassword, ...safe } = u;
  return safe;
}

async function saveUser(user) {
  USERS = await loadUsers();
  USERS[user.id] = user;
  await saveUsers(USERS);
}

// ----------------- GOOGLE OAUTH -----------------
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      async (accessToken, refreshToken, profile, done) => {
        USERS = await loadUsers();

        let user = Object.values(USERS).find(
          (u) => u.oauthGoogle === profile.id
        );

        if (!user) {
          user = {
            id: uuidv4(),
            name: profile.displayName,
            type: "google",
            oauthGoogle: profile.id,
          };
          await saveUser(user);
        }

        done(null, user);
      }
    )
  );
} else {
  console.warn("⚠ Google OAuth disabled (missing env vars)");
}

// ----------------- DISCORD OAUTH -----------------
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(
    "discord",
    new OAuth2Strategy(
      {
        authorizationURL: "https://discord.com/api/oauth2/authorize",
        tokenURL: "https://discord.com/api/oauth2/token",
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: "/auth/discord/callback",
        scope: ["identify"],
      },
      async (accessToken, refreshToken, params, done) => {
        try {
          const response = await fetch(
            "https://discord.com/api/users/@me",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          const discord = await response.json();

          USERS = await loadUsers();

          let user = Object.values(USERS).find(
            (u) => u.oauthDiscord === discord.id
          );

          if (!user) {
            user = {
              id: uuidv4(),
              name: discord.username,
              type: "discord",
              oauthDiscord: discord.id,
            };
            await saveUser(user);
          }

          done(null, user);
        } catch (err) {
          console.error("Discord OAuth error:", err);
          done(err, null);
        }
      }
    )
  );
} else {
  console.warn("⚠ Discord OAuth disabled (missing env vars)");
}

// --- GUEST REGISTER ---
router.post("/guest/register", async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.json({ ok: false, error: "Invalid password" });

    const id = uuidv4();
    const hashed = await bcrypt.hash(password, 10);
    const name = "Guest" + Math.floor(Math.random() * 9999);

    const user = { id, name, type: "guest", guestPassword: hashed };
    await saveUser(user);

    req.login(user, (err) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true, user: publicUser(user) });
    });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, error: "Server error" });
  }
});

// --- GUEST LOGIN ---
router.post("/guest/login", async (req, res) => {
try {
const { username, password } = req.body;
if (!username || !password) return res.json({ ok: false, error: "Missing credentials" });

    const USERS = await loadUsers();
    const user = Object.values(USERS).find(u => u.type === "guest" && u.name === username);

    if (!user) return res.json({ ok: false, error: "Guest not found" });

    const match = await bcrypt.compare(password, user.guestPassword);
    if (!match) return res.json({ ok: false, error: "Wrong password" });

    req.login(user, (err) => {
        if (err) return res.json({ ok: false, error: err.message });
        res.json({ ok: true, user: publicUser(user) });
    });
} catch (err) {
    console.error("Guest login error:", err);
    res.json({ ok: false, error: "Server error" });
}

});

// ----------------- SESSION CHECK -----------------
router.get("/me", async (req, res) => {
  if (req.user) res.json({ ok: true, user: publicUser(req.user) });
  else res.json({ ok: false });
});

// ----------------- LOGOUT -----------------
router.post("/logout", (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

// ----------------- OAUTH ROUTES -----------------
router.get("/google", (req, res, next) =>
  passport.authenticate("google", {
    scope: ["profile"],
    state: req.query.redirect === "json" ? "json" : undefined,
  })(req, res, next)
);

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    if (req.query.state === "json")
      return res.json({ ok: true, user: publicUser(req.user) });
    res.redirect("/FivesDiceGame");
  }
);

router.get("/discord", (req, res, next) =>
  passport.authenticate("discord", {
    state: req.query.redirect === "json" ? "json" : undefined,
  })(req, res, next)
);

router.get(
  "/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    if (req.query.state === "json")
      return res.json({ ok: true, user: publicUser(req.user) });
    res.redirect("/FivesDiceGame");
  }
);