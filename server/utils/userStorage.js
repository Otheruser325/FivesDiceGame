import { Low } from "lowdb"
import { JSONFile } from "lowdb/node"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// JSON database for users
const file = path.join(__dirname, "../data/users.json")
const adapter = new JSONFile(file)
const db = new Low(adapter)

// Initialize DB
await db.read()
db.data ||= { users: {} }
await db.write()

// ---------------- HELPERS ----------------

export async function loadUsers() {
  await db.read()

  // Ensure the structure exists but DO NOT reset db.data
  if (!db.data || typeof db.data !== "object") {
    db.data = { users: {} }
  }

  if (!db.data.users || typeof db.data.users !== "object") {
    db.data.users = {}
  }

  return db.data.users
}

export async function saveUsers(users) {
  await db.read()

  // Never wipe db.data — only replace the users section
  if (!db.data || typeof db.data !== "object") {
    db.data = { users: {} }
  }

  db.data.users = { ...users }

  await db.write()
}