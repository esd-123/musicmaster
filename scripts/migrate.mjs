// Applies pending Drizzle migrations against DATABASE_PATH. Run this before
// starting the server — plain JS (not TS) so it can run directly in the
// production container without a build step.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = process.env.DATABASE_PATH ?? "./data/app.db";
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

// `PRAGMA foreign_keys` is a no-op inside an active transaction, and
// drizzle's migrator wraps the whole migration file in one — so a
// migration's own `PRAGMA foreign_keys=OFF;` line (emitted whenever a table
// with incoming FK references needs the SQLite recreate-table dance) never
// actually takes effect there. Toggling it here, before the migrator opens
// its transaction, is what actually works.
sqlite.pragma("foreign_keys = OFF");
migrate(db, { migrationsFolder: "./drizzle" });
sqlite.pragma("foreign_keys = ON");
console.log(`[migrate] applied migrations against ${dbPath}`);

sqlite.close();
