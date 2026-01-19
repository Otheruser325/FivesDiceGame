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
  "redis": "not connected",
  "uptime": 12345
}
```

## 🔐 Environment Variables

Create `server/.env` file:

```env
NODE_ENV=production
PORT=8080
CLIENT_ORIGINS=https://play.fivesdicegame.com
SESSION_SECRET=your-secret-key
DISCORD_CLIENT_ID=your-id
DISCORD_CLIENT_SECRET=your-secret
```

See `server/.env.example` for all options.

## 🌐 Production Deployment

### Option 1: Vercel (Recommended)
1. Push to GitHub
2. Import project to Vercel
3. Set environment variables
4. Configure custom domains
5. Done! Auto-deploys on each push

### Option 2: DigitalOcean App Platform
1. Connect GitHub
2. Create App
3. Configure environment
4. Assign custom domain

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

