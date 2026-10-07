import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoryPrivacy = "PUBLIC" | "FOLLOWERS_ONLY" | "CLOSE_FRIENDS";
export type StoryMediaType = "IMAGE" | "VIDEO";

export type StoryRow = {
  id: string;
  owner_id: string;
  privacy: StoryPrivacy;
  created_at: string;
  expires_at: string;
  is_deleted: number;
  archived: number;
  highlight_title: string | null;
};

let database: DatabaseSync | undefined;

function initializeSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      follower_count INTEGER NOT NULL DEFAULT 0,
      is_private INTEGER NOT NULL DEFAULT 0,
      email TEXT,
      phone TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      privacy TEXT NOT NULL CHECK(privacy IN ('PUBLIC','FOLLOWERS_ONLY','CLOSE_FRIENDS')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      highlight_title TEXT,
      FOREIGN KEY(owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS story_media (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('IMAGE','VIDEO')),
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(story_id) REFERENCES stories(id)
    );

    CREATE TABLE IF NOT EXISTS story_views (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(story_id, viewer_id),
      FOREIGN KEY(story_id) REFERENCES stories(id),
      FOREIGN KEY(viewer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS story_reactions (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(story_id, user_id),
      FOREIGN KEY(story_id) REFERENCES stories(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS story_replies (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(story_id) REFERENCES stories(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      story_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id),
      FOREIGN KEY(story_id) REFERENCES stories(id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT NOT NULL CHECK(plan_id IN ('free','bronze','silver','gold')),
      status TEXT NOT NULL CHECK(status IN ('active','expired','cancelled','pending')),
      started_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      cancelled_at TEXT,
      gateway_subscription_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subscription_id TEXT,
      plan_id TEXT NOT NULL DEFAULT 'bronze',
      gateway_order_id TEXT UNIQUE,
      gateway_payment_id TEXT UNIQUE,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL CHECK(status IN ('created','paid','failed','refunded')),
      receipt_email_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
    );

    CREATE TABLE IF NOT EXISTS otp_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      language TEXT NOT NULL CHECK(language IN ('en','es','hi','pt','zh','fr')),
      channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT NOT NULL,
      verified_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS otp_lockouts (
      user_id TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_stories_owner_created ON stories(owner_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_otp_user_expiry ON otp_challenges(user_id, expires_at);
  `);

  const columns = new Set((db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("email")) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  if (!columns.has("phone")) db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
  if (!columns.has("preferred_language")) db.exec("ALTER TABLE users ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'en'");

  const paymentColumns = new Set((db.prepare("PRAGMA table_info(payments)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!paymentColumns.has("plan_id")) db.exec("ALTER TABLE payments ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'bronze'");
  if (!paymentColumns.has("receipt_email_sent_at")) db.exec("ALTER TABLE payments ADD COLUMN receipt_email_sent_at TEXT");

}

export function getDb() {
  if (!database) {
    const databasePath = join(process.cwd(), "data", "storyline.db");
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    initializeSchema(database);
  }

  const db = database;
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    transaction: <TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult) => (...args: TArgs) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn(...args);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function seedDefaultData() {
  return true;
}
