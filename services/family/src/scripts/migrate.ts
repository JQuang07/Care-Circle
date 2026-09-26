// Creates the family schema + tables (idempotent). Usage: npm run migrate
import pg from "pg";
import { loadConfig } from "../config.js";
import { migrate } from "../store/postgres.js";

const cfg = loadConfig();
if (!cfg.databaseUrl) throw new Error("DATABASE_URL is not set");
const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
await migrate(pool);
console.log("family schema migrated");
await pool.end();
