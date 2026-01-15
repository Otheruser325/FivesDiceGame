import express from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import OAuth2Strategy from "passport-oauth2";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { loadUsers, saveUsers, loadUser, saveUser } from "./utils/userStorage.js";

export const router = express.Router();
router.use(express.json());

// PASSPORT SESSION
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const u = await loadUser(id);
    done(null, u || null);
  } catch (err) {
    done(err, null);
  }
});

// Helper to check if a strategy is registered
function isStrategyAvailable(name) {
  return passport._strategies && passport._strategies[name];
}

// Helper to handle missing strategy gracefully
function requireStrategy(strategyName, fallbackMsg) {
  return (req, res, next) => {
    if (!isStrategyAvailable(strategyName)) {
      console.warn(`[Auth] Strategy '${strategyName}' not available`);
      const message = encodeURIComponent(fallbackMsg || `${strategyName} OAuth is not configured`);
      return res.redirect(`/?error=${message}`);
    }
    next();
  };
}

// SAFE HELPER
function publicUser(u) {
  if (!u) return null;
  const { guestPassword, ...safe } = u;
  return safe;
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
        try {
          const users = await loadUsers();
          let user = Object.values(users).find((u) => u.oauthGoogle === profile.id);

          if (!user) {
            user = {
              id: uuidv4(),
              name: profile.displayName || `GoogleUser${Math.floor(Math.random() * 9999)}`,
              type: "google",
              oauthGoogle: profile.id,
              avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : null
            };
            await saveUser(user);
          }
          done(null, user);
        } catch (err) {
          console.error('Google oauth error:', err);
          done(err, null);
        }
      }
    )
  );
} else {
  console.warn("⚠ Google OAuth disabled (missing env vars)");
}

// ----------------- DISCORD OAUTH -----------------
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  // Support dynamic callback URLs for localhost development
  // In production, set DISCORD_CALLBACK_URL env var to your production URL
  const discordCallbackURL = process.env.DISCORD_CALLBACK_URL || 
    (process.env.NODE_ENV === 'development' ? 'http://localhost:8080/auth/discord/callback' : '/auth/discord/callback');
  
  passport.use(
    "discord",
    new OAuth2Strategy(
      {
        authorizationURL: "https://discord.com/api/oauth2/authorize",
        tokenURL: "https://discord.com/api/oauth2/token",
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: discordCallbackURL,
        scope: ["identify"],
      },
      async (accessToken, refreshToken, params, done) => {
        try {
          const response = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const discord = await response.json();

          const users = await loadUsers();
          let user = Object.values(users).find((u) => u.oauthDiscord === discord.id);

          if (!user) {
            user = {
              id: uuidv4(),
              name: discord.username || `Discord${Math.floor(Math.random() * 9999)}`,
              type: "discord",
              oauthDiscord: discord.id,
              avatar: discord.avatar ? `https://cdn.discordapp.com/avatars/${discord.id}/${discord.avatar}.png` : null
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

    // Build the user object
    const user = { id, name, type: "guest", guestPassword: hashed };

    // Save (this will try Supabase then fallback to local)
    let saved;
    try {
      saved = await saveUser(user);
    } catch (err) {
      console.error("[auth] saveUser failed:", err);
      return res.json({ ok: false, error: "Failed to create user" });
    }

    // Log the saved user id for debugging (do not log secrets)
    console.log(`[auth] Guest created: ${saved.id} (${saved.name})`);

    // Log user into session using the authoritative saved user
    req.login(saved, (err) => {
      if (err) {
        console.error('[auth] req.login failed after guest register:', err);
        return res.json({ ok: false, error: err.message });
      }
      // send the public-safe version back
      res.json({ ok: true, user: publicUser(saved) });
    });
  } catch (e) {
    console.error('[auth] guest register error:', e);
    res.json({ ok: false, error: "Server error" });
  }
});

// --- GUEST LOGIN ---
router.post("/guest/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: "Missing credentials" });

    const users = await loadUsers();
    const user = Object.values(users).find(u => u.type === "guest" && u.name === username);

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
router.get("/google", 
  requireStrategy("google", "Google OAuth is not configured on this server. Please restart the server with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set."),
  (req, res, next) =>
    passport.authenticate("google", {
      scope: ["profile"],
      state: req.query.redirect === "json" ? "json" : undefined,
    })(req, res, next)
);

router.get(
  "/google/callback",
  requireStrategy("google", "Google OAuth is not configured"),
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    if (req.query.state === "json") return res.json({ ok: true, user: publicUser(req.user) });
    res.redirect("/FivesDiceGame");
  }
);

router.get("/discord",
  requireStrategy("discord", "Discord OAuth is not configured on this server. Please restart the server with DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET set."),
  (req, res, next) =>
    passport.authenticate("discord", {
      state: req.query.redirect === "json" ? "json" : undefined,
    })(req, res, next)
);

router.get(
  "/discord/callback",
  requireStrategy("discord", "Discord OAuth is not configured"),
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    if (req.query.state === "json") return res.json({ ok: true, user: publicUser(req.user) });
    res.redirect("/FivesDiceGame");
  }
);

// ---------- REPORT AVAILABLE AUTH METHODS ----------
router.get("/methods", (req, res) => {
  const methods = {
    guest: true, // Always available
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    discord: !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET),
  };
  res.json(methods);
});