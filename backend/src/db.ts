import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.DATABASE_PATH || "./data/hsk-quiz.sqlite";
const dbPath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(process.cwd(), configuredPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  standard TEXT NOT NULL CHECK (standard IN ('HSK2', 'HSK3')),
  level INTEGER NOT NULL,
  hanzi TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  meaning TEXT NOT NULL,
  example_hanzi TEXT,
  example_pinyin TEXT,
  example_meaning TEXT,
  source_note TEXT NOT NULL DEFAULT 'starter sample; verify before exam use',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(standard, hanzi, pinyin)
);
CREATE INDEX IF NOT EXISTS idx_vocab_range ON vocabulary(standard, level);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  standard TEXT NOT NULL CHECK (standard IN ('HSK2', 'HSK3')),
  min_level INTEGER NOT NULL,
  max_level INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('MIXED', 'ZH_TO_EN', 'EN_TO_ZH')),
  question_count INTEGER NOT NULL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id),
  direction TEXT NOT NULL CHECK (direction IN ('ZH_TO_EN', 'EN_TO_ZH')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id),
  answered INTEGER NOT NULL DEFAULT 0,
  selected_vocabulary_id INTEGER REFERENCES vocabulary(id),
  is_correct INTEGER,
  answered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_session ON quiz_questions(session_id);

CREATE TABLE IF NOT EXISTS saved_words (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id, vocabulary_id)
);

CREATE TABLE IF NOT EXISTS answer_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id),
  selected_vocabulary_id INTEGER NOT NULL REFERENCES vocabulary(id),
  is_correct INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_answers_user ON answer_history(user_id, created_at);
`);
