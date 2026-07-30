// Applies pending Drizzle migrations against DATABASE_PATH. Run this before
// starting the server — plain JS (not TS) so it can run directly in the
// production container without a build step.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dbPath = process.env.DATABASE_PATH ?? "./data/app.db";
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });
console.log(`[migrate] applied migrations against ${dbPath}`);

sqlite.close();
