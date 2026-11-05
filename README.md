# FivesDiceGame

A simple yet popular dice game that can be played locally or online with friends!

## 🎮 Features

- ✅ **Local Multiplayer** - Play with friends on the same device
- ✅ **Online Multiplayer** - Play with friends online via Socket.io
- ✅ **Cross-Platform** - Works on desktop browsers (mobile support coming)
- ✅ **Real-Time Gameplay** - Instant updates across all players
- ✅ **Multiple Game Modes** - Different configurations and difficulty levels

## 🚀 Quick Start

### Prerequisites
- Node.js v18 or higher
- npm or yarn

### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/FivesDiceGame.git
cd FivesDiceGame

# Run setup script (Windows)
setup.bat

# OR Run setup script (Mac/Linux)
bash setup.sh

# Start development server
npm run dev

# Open browser
http://localhost:8080
```

## 📚 Documentation

- **[DEVELOPMENT.md](DEVELOPMENT.md)** - Local development guide, architecture, debugging tips
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Production deployment guide for your domains
- **[SOCKET_IO_GUIDE.md](SOCKET_IO_GUIDE.md)** - Socket.io optimization and troubleshooting
- **[RULES.md](RULES.md)** - Complete game rules (if exists)

## 🏗️ Project Structure

```
FivesDiceGame/
├── client/                 # Phaser game client
│   ├── scenes/            # Game scenes
│   ├── utils/             # Utilities (Socket.io, Audio, Animation)
│   ├── assets/            # Game assets
│   └── main.js            # Game entry point
├── server/                # Node.js server
│   ├── index.js           # Express + Socket.io server
│   ├── lobbyManager.js    # Game lobby logic
│   ├── auth.js            # Authentication
│   └── utils/             # Server utilities
├── web/                   # Marketing website
└── README.md              # This file
```

## 🎯 Domain Setup

To deploy with your domains (fivesdicegame.com):

1. **Server** → `api.fivesdicegame.com`
2. **Game Client** → `play.fivesdicegame.com`
3. **Website** → `fivesdicegame.com`

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

## 🔧 Server Technologies

- **Framework**: Express.js
- **Real-Time**: Socket.io v4.7+
- **Authentication**: Passport.js (Discord, Google OAuth)
- **Session**: Express-session with Redis support
- **Database**: Local JSON (with Supabase migration option)

## 🎮 Game Technologies

- **Engine**: Phaser 3
- **Language**: JavaScript (ES6+)
- **Real-Time**: Socket.io Client
- **Audio**: Web Audio API

## 📡 Online Multiplayer

The game uses **Socket.io** for real-time multiplayer:

- ✅ Battle-tested and production-ready
- ✅ Automatic fallback to polling if WebSocket unavailable
- ✅ Excellent for turn-based games
- ✅ Handles 5000+ concurrent connections

**Why not Colyseus?** Socket.io is simpler and more than sufficient for this turn-based dice game. Colyseus adds complexity without benefits for our use case.

### Diceathon events

Diceathon starts on 31 October 2026 at 00:00 UTC, lasts seven days, and repeats
every 14 days. The event button appears one day before each start; matchmaking
opens at the start and closes at the end. Matches use six distinct signed-in
players and a randomly selected Classic, Combanity, Multiplex, or combined
Combanity + Multiplex table. Queued players can cancel; unfinished games may
continue after the event closes. There are no prizes or event standings.

The queue and games live in the running server process, like existing online
games. Use one persistent Socket.IO server for matchmaking; serverless hosts,
multiple independent server instances, and process restarts cannot share or
recover the queue. Players disconnected or signed out while waiting must join
again.

## 🧪 Testing

### Local Multiplayer Testing
1. Open `http://localhost:8080` in two browser windows
2. Create lobby in window 1
3. Join lobby in window 2
4. Start game and play!

### Network Testing
Connect from different devices on same network:
```bash
# Find your machine's IP
ipconfig  # Windows
ifconfig  # Mac/Linux

# Connect from remote device
http://<your-ip>:8080
```

## 📊 Health Check

Monitor server status:
```bash
curl http://localhost:8080/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-16T...",
  "uptime": 12345
}
```

The health response intentionally does not disclose the session-store backend or
connection state. API JSON responses also carry baseline security headers
(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a restrictive
`Content-Security-Policy`, and HSTS in production).

## 🔐 Environment Variables

Create `server/.env` file:

```env
NODE_ENV=production
PORT=8080
CLIENT_ORIGINS=https://play.fivesdicegame.com
SESSION_SECRET=your-secret-key
REDIS_URL=redis://your-redis-host:6379
TRUST_PROXY=1
DISCORD_CLIENT_ID=your-id
DISCORD_CLIENT_SECRET=your-secret
```

`TRUST_PROXY` is the number of reverse proxies in front of the API. It defaults
to `1` on detected hosting platforms and `0` elsewhere. Set it to `0` when the
server is directly exposed; otherwise clients can spoof `X-Forwarded-For` and
buy themselves fresh rate-limit buckets.

`REDIS_URL` is required when `NODE_ENV=production`. If Redis is absent or cannot
be reached, startup fails rather than silently using process-local sessions. For
a single persistent instance that accepts sessions being lost on restart, the
explicit `ALLOW_MEMORY_SESSIONS=1` opt-out allows the memory store. Do not use
that opt-out with multiple instances or on serverless hosting.

### Durable accounts

In production, configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the
`users` table. Account creation fails if storage is unavailable or the table
cannot retain the account fields; it no longer silently creates memory-only
accounts. Before deploying, check that the existing table supports the fields
used by guest and OAuth accounts, including `guestpassword`, `oauthGoogle`,
`oauthDiscord`, `oauthProvider`, and `oauthProviderId` (with their exact case).
An existing database may require a schema migration; test it before rollout.
For multiple server instances, enforce unique new guest names in the database,
after resolving any historical duplicates; local files are single-instance only.

Alternatively, on a single persistent server, set `USER_STORAGE_MODE=local` and
`USER_DATA_FILE` to an absolute path on a persistent writable volume, with its
parent directory already present. Do not use ephemeral hosting filesystems or
Vercel for local accounts. Back up and migrate any existing user data to the
chosen store before switching; memory-only accounts cannot be recovered after a
restart. Test account creation and login across a restart after configuration.

`CLIENT_ORIGINS` is a comma-separated list of allowed **game client** origins.
OAuth callbacks instead point to the **API**, not the game client. The server
selects the callback matching the API origin the client is using, so a Render
fallback stays on Render and a working custom API stays on the custom domain.
The selected URL is kept with the OAuth session for the token exchange.

The Render and custom API callback URLs are supported by default. To allow
additional API origins, configure a comma-separated list per provider:

```env
GOOGLE_CALLBACK_URLS=https://fivesapi.onrender.com/auth/google/callback,https://api.fivesdicegame.com/auth/google/callback
DISCORD_CALLBACK_URLS=https://fivesapi.onrender.com/auth/discord/callback,https://api.fivesdicegame.com/auth/discord/callback
```

The existing `GOOGLE_CALLBACK_URL` and `DISCORD_CALLBACK_URL` variables remain
supported; each may also contain a comma-separated list. `PUBLIC_SERVER_URL`
sets the fallback API origin when the request host does not match a callback.
Register **each exact callback URL** you intend to use in the corresponding
Google Cloud or Discord developer application. HTTPS is required outside local
development. Setting a URL does not check that the domain is online or enable
Google OAuth without its client ID and secret. Use a shared session store such
as Redis if traffic can reach multiple server instances; switching API hosts
mid-flow can lose the host-bound session cookie.

## 🌐 Production Deployment

### Option 1: Render (Recommended for server)
1. Create a Render Web Service with root directory `server`
2. Set Build Command to `npm ci` and Start Command to `npm start`
3. Set environment variables (see `server/.env.example`)
4. Set Health Check Path to `/health`
5. Deploy and verify `/socket.io` and `/health` endpoints

### Option 2: Static + API split
1. Deploy `client/` and `web/` to static hosting (Vercel/Netlify/etc)
2. Deploy `server/` to Render or another persistent Node host
3. Set `CLIENT_ORIGINS` to include your client domain(s)
4. Keep API URL pointed at your server host

### Option 3: Self-Hosted
1. Deploy to VPS/Dedicated Server
2. Use PM2 or systemd for process management
3. Set up Nginx/Apache reverse proxy
4. Configure SSL with Let's Encrypt

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed steps.

## 🐛 Troubleshooting

### "Connection Refused"
- Verify server is running
- Check port 8080 is accessible
- See DEVELOPMENT.md for debugging tips

### "CORS Error"
- Ensure CLIENT_ORIGINS includes your domain
- Restart server after changing .env
- See SOCKET_IO_GUIDE.md for more details

### "Socket.io Connection Timeout"
- Server may be down
- Check browser console for errors
- Verify firewall allows connections

For more help, see [SOCKET_IO_GUIDE.md](SOCKET_IO_GUIDE.md).

## 📈 Performance

- **Server capacity**: 5000+ concurrent players
- **Message latency**: < 100ms typical
- **Network bandwidth**: < 5KB/min per player
- **Current game load**: ~1-2 messages/second per player

See [SOCKET_IO_GUIDE.md](SOCKET_IO_GUIDE.md) for optimization details.

## 🎓 Learning Resources

- [Phaser 3 Docs](https://photonstorm.github.io/phaser3-docs/)
- [Socket.io Docs](https://socket.io/docs/)
- [Express.js Guide](https://expressjs.com/)
- [Game Design Patterns](https://gameprogrammingpatterns.com/)

## 📝 License

This project is open source. See [LICENSE](LICENSE) for details.

## 👥 Contributing

Contributions welcome! Please feel free to submit Pull Requests.

## 🎯 Roadmap

- [ ] Mobile app version
- [ ] Tournament system
- [ ] Player profiles and statistics
- [ ] Spectator mode
- [ ] Voice chat integration
- [ ] Custom skins/themes

## 📞 Support

- 📖 Read [DEVELOPMENT.md](DEVELOPMENT.md) for local setup
- 🚀 Read [DEPLOYMENT.md](DEPLOYMENT.md) for production
- 🔧 Read [SOCKET_IO_GUIDE.md](SOCKET_IO_GUIDE.md) for troubleshooting

---

**Made with ❤️ for dice game lovers everywhere!**
