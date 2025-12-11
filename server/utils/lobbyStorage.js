import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// JSON database for lobbies
const file = path.join(__dirname, "../data/lobbies.json")
const adapter = new JSONFile(file)
const db = new Low(adapter)

await db.read()
db.data ||= { lobbies: {} }
await db.write()

// ---------------- HELPERS ----------------

export async function loadLobbies() {
  await db.read()

  if (!db.data || typeof db.data !== "object") {
    db.data = { lobbies: {} }
  }

  if (!db.data.lobbies || typeof db.data.lobbies !== "object") {
    db.data.lobbies = {}
  }

  return db.data.lobbies
}

export async function saveLobbies(lobbies) {
  await db.read()

  if (!db.data || typeof db.data !== "object") {
    db.data = { lobbies: {} }
  }

  db.data.lobbies = { ...lobbies }

  await db.write()
}