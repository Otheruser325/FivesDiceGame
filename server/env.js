import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer server/.env for local development while keeping hosted env vars intact.
dotenv.config({ path: path.join(__dirname, '.env') });
// Also allow repository-root .env if present.
dotenv.config();
