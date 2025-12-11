import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const file = path.join(__dirname, "data/lobbies.json");
const adapter = new JSONFile(file);
const db = new Low(adapter);

await db.read();
db.data ||= { lobbies: [] };
await db.write();

export default db;