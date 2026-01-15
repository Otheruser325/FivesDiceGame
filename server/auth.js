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
  // ⚠️ CRITICAL: Discord OAuth requires absolute HTTPS URL
  // Determine the correct callback URL based on environment
  let discordCallbackURL;
  
  if (process.env.DISCORD_CALLBACK_URL) {
    // Explicit override (highest priority)
    discordCallbackURL = process.env.DISCORD_CALLBACK_URL;
  } else if (process.env.VERCEL === '1') {
    // Vercel production - use HTTPS and Vercel URL
    const vercelUrl = process.env.VERCEL_URL || 'fivesapi.vercel.app';
    discordCallbackURL = `https://${vercelUrl}/auth/discord/callback`;
  } else if (process.env.NODE_ENV === 'production') {
    // Other production - use HTTPS with host header
    discordCallbackURL = `https://${process.env.HOST || 'localhost'}/auth/discord/callback`;
  } else {
    // Development - use HTTP localhost
    discordCallbackURL = 'http://localhost:8080/auth/discord/callback';
  }
  
  console.log('[Discord OAuth] Callback URL:', discordCallbackURL);
  
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
          
          if (!response.ok) {
            console.error('[Discord] API error:', response.status, response.statusText);
            return done(new Error(`Discord API error: ${response.status}`));
          }
          
          const discord = await response.json();
          
          if (!discord.id) {
            console.error('[Discord] No user ID in response:', discord);
            return done(new Error('Invalid Discord user response'));
          }

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
            console.log('[Discord] Creating new user:', { id: user.id, name: user.name });
            await saveUser(user);
          }

          console.log('[Discord] OAuth successful for user:', user.id);
          done(null, user);
        } catch (err) {
          console.error('[Discord] OAuth error:', err?.message || err);
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

// Handle OPTIONS preflight for Discord callback
router.options("/discord/callback", (req, res) => {
  const origin = req.headers.origin;
  if (origin && (origin.includes('vercel.app') || origin.includes('localhost'))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
  }
  res.status(200).end();
});

router.get(
  "/discord/callback",
  requireStrategy("discord", "Discord OAuth is not configured"),
  (req, res, next) => {
    // Set comprehensive CORS headers for the callback
    const origin = req.headers.origin;
    if (origin && (origin.includes('vercel.app') || origin.includes('localhost'))) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      // Set additional headers to help with cross-site cookie issues
      res.header('Vary', 'Origin');
      res.header('Access-Control-Expose-Headers', 'Set-Cookie');
      res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.header('Pragma', 'no-cache');
      res.header('Expires', '0');
    }
    
    // Add custom error handler for Discord auth
    passport.authenticate("discord", (err, user, info) => {
      if (err) {
        console.error('[Discord callback] Authentication error:', err?.message || err);
        const errorMsg = encodeURIComponent(`Discord login failed: ${err?.message || 'Unknown error'}`);
        return res.redirect(`/?error=${errorMsg}`);
      }
      
      if (!user) {
        console.warn('[Discord callback] No user returned from strategy');
        return res.redirect('/?error=Discord%20login%20failed');
      }
      
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error('[Discord callback] Login error:', loginErr?.message || loginErr);
          const errorMsg = encodeURIComponent(`Login failed: ${loginErr?.message || 'Unknown error'}`);
          return res.redirect(`/?error=${errorMsg}`);
        }
        
        // Enhanced session configuration for cross-site authentication
        req.session.authenticated = true;
        req.session.provider = 'discord';
        req.session.loginTime = new Date().toISOString();
        req.session.lastActivity = new Date().toISOString();
        
        // Ensure session is properly configured for cross-site cookies
        if (process.env.NODE_ENV === 'production') {
          req.session.cookie.sameSite = 'none';
          req.session.cookie.secure = true;
          req.session.cookie.domain = '.vercel.app';
          req.session.cookie.partitioned = true;
          req.session.cookie.priority = 'high';
        }
        
        // Save session with enhanced error handling and retry logic
        req.session.save(async (saveErr) => {
          if (saveErr) {
            console.error('[Discord callback] Session save error:', saveErr?.message || saveErr);
            
            // Try to save session again with fallback options
            try {
              await new Promise((resolve, reject) => {
                req.session.save((fallbackErr) => {
                  if (fallbackErr) {
                    console.error('[Discord callback] Fallback session save failed:', fallbackErr?.message || fallbackErr);
                    reject(fallbackErr);
                  } else {
                    console.log('[Discord callback] Fallback session save successful');
                    resolve();
                  }
                });
              });
            } catch (fallbackErr) {
              console.error('[Discord callback] All session save attempts failed:', fallbackErr?.message || fallbackErr);
              const errorMsg = encodeURIComponent(`Session save failed: ${fallbackErr?.message || 'Unknown error'}`);
              return res.redirect(`/?error=${errorMsg}`);
            }
          }
          
          console.log('[Discord callback] Session saved successfully');
          
          // Set additional cookies for cross-site authentication
          if (process.env.NODE_ENV === 'production') {
            // Set authentication indicator cookie
            res.cookie('auth_provider', 'discord', {
              maxAge: 24 * 60 * 60 * 1000, // 24 hours
              httpOnly: false, // Allow JavaScript access
              secure: true,
              sameSite: 'none',
              domain: '.vercel.app',
              partitioned: true
            });
            
            // Set session confirmation cookie
            res.cookie('session_confirmed', 'true', {
              maxAge: 24 * 60 * 60 * 1000, // 24 hours
              httpOnly: false,
              secure: true,
              sameSite: 'none',
              domain: '.vercel.app',
              partitioned: true
            });
          }
          
          // Success - redirect with timestamp to prevent caching
          if (req.query.state === "json") {
            return res.json({
              ok: true,
              user: publicUser(user),
              sessionId: req.sessionID,
              timestamp: Date.now()
            });
          }
          
          const redirectUrl = "/FivesDiceGame?auth=success&provider=discord&timestamp=" + Date.now();
          console.log('[Discord callback] Redirecting to:', redirectUrl);
          res.redirect(redirectUrl);
        });
      });
    })(req, res, next);
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