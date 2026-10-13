import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import cors from "cors";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "./db.js";
import { clearSessionCookie, optionalAuth, requireAuth, setSessionCookie, type AuthRequest } from "./auth.js";

const app = express();
const port = Number(process.env.PORT || 3000);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(optionalAuth);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Please try again later." } });
const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_.-]+$/, "Username may contain letters, numbers, dots, underscores, and hyphens."),
  password: z.string().min(8).max(128)
});
const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(128) });
const quizSchema = z.object({
  standard: z.enum(["HSK2", "HSK3"]),
  minLevel: z.number().int().min(1).max(9),
  maxLevel: z.number().int().min(1).max(9),
  direction: z.enum(["MIXED", "ZH_TO_EN", "EN_TO_ZH"]),
  questionCount: z.number().int().min(1).max(50)
});
const answerSchema = z.object({ questionId: z.string().uuid(), selectedVocabularyId: z.number().int().positive() });
const userPublic = (row: any) => ({ id: row.id, email: row.email, username: row.username });

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/auth/register", authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid registration details." });
    const { email, username, password } = parsed.data;
    const hash = await bcrypt.hash(password, 12);
    try {
      const result = db.prepare("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)").run(email, username, hash);
      const user = db.prepare("SELECT id, email, username FROM users WHERE id = ?").get(result.lastInsertRowid);
      setSessionCookie(res, Number(result.lastInsertRowid));
      res.status(201).json({ user });
    } catch (e: any) {
      if (e?.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That email or username is already registered." });
      throw e;
    }
  } catch (e) { next(e); }
});
app.post("/api/auth/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email/username and password." });
    const { identifier, password } = parsed.data;
    const row = db.prepare("SELECT id, email, username, password_hash FROM users WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE").get(identifier, identifier) as any;
    const valid = row ? await bcrypt.compare(password, row.password_hash) : false;
    if (!valid) return res.status(401).json({ error: "Invalid login details." });
    setSessionCookie(res, row.id);
    res.json({ user: userPublic(row) });
  } catch (e) { next(e); }
});
app.post("/api/auth/logout", (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
app.get("/api/auth/me", (req: AuthRequest, res) => {
  if (!req.userId) return res.json({ user: null });
  const row = db.prepare("SELECT id, email, username FROM users WHERE id = ?").get(req.userId);
  res.json({ user: row || null });
});

app.get("/api/vocabulary", (req, res) => {
  const standard = req.query.standard === "HSK3" ? "HSK3" : "HSK2";
  const max = standard === "HSK2" ? 6 : 9;
  const minLevel = Math.max(1, Math.min(max, Number(req.query.minLevel || 1)));
  const maxLevel = Math.max(minLevel, Math.min(max, Number(req.query.maxLevel || max)));
  const rows = db.prepare("SELECT id, standard, level, hanzi, pinyin, meaning, example_hanzi AS exampleHanzi, example_pinyin AS examplePinyin, example_meaning AS exampleMeaning FROM vocabulary WHERE standard = ? AND level BETWEEN ? AND ? ORDER BY level, hanzi").all(standard, minLevel, maxLevel);
  res.json({ items: rows });
});

app.post("/api/quizzes", (req: AuthRequest, res, next) => {
  try {
    const parsed = quizSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid quiz settings." });
    const { standard, minLevel, maxLevel, direction, questionCount } = parsed.data;
    const highest = standard === "HSK2" ? 6 : 9;
    if (minLevel > maxLevel || maxLevel > highest) return res.status(400).json({ error: `Choose valid levels for ${standard}.` });
    const words = db.prepare("SELECT id, standard, level, hanzi, pinyin, meaning, example_hanzi, example_pinyin, example_meaning FROM vocabulary WHERE standard = ? AND level BETWEEN ? AND ?").all(standard, minLevel, maxLevel) as any[];
    if (words.length < 4) return res.status(400).json({ error: "There are not enough words in this range yet. Import more vocabulary or choose a wider range." });
    const count = Math.min(questionCount, words.length);
    const shuffled = [...words].sort(() => Math.random() - 0.5).slice(0, count);
    const sessionResult = db.prepare("INSERT INTO quiz_sessions (user_id, standard, min_level, max_level, direction, question_count) VALUES (?, ?, ?, ?, ?, ?)").run(req.userId ?? null, standard, minLevel, maxLevel, direction, count);
    const sessionId = Number(sessionResult.lastInsertRowid);
    const insertQ = db.prepare("INSERT INTO quiz_questions (id, session_id, vocabulary_id, direction, prompt, options_json, correct_vocabulary_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const responseQuestions = shuffled.map((word: any) => {
      const qDirection = direction === "MIXED" ? (Math.random() < .5 ? "ZH_TO_EN" : "EN_TO_ZH") : direction;
      const distractors = words.filter((x: any) => x.id !== word.id).sort(() => Math.random() - .5).slice(0, 3);
      const options = [...distractors, word].sort(() => Math.random() - .5).map((x: any) => ({
        vocabularyId: x.id,
        label: qDirection === "ZH_TO_EN" ? x.meaning : x.hanzi
      }));
      const questionId = crypto.randomUUID();
      const prompt = qDirection === "ZH_TO_EN" ? word.hanzi : word.meaning;
      insertQ.run(questionId, sessionId, word.id, qDirection, prompt, JSON.stringify(options), word.id);
      return { id: questionId, vocabularyId: word.id, direction: qDirection, prompt, options };
    });
    res.status(201).json({ quiz: { id: sessionId, standard, direction, minLevel, maxLevel, questionCount: count }, questions: responseQuestions });
  } catch (e) { next(e); }
});

app.post("/api/quizzes/:id/answer", (req: AuthRequest, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId) || sessionId < 1) return res.status(400).json({ error: "Invalid quiz session." });
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid answer." });
    const { questionId, selectedVocabularyId } = parsed.data;
    const session = db.prepare("SELECT id, user_id, completed FROM quiz_sessions WHERE id = ?").get(sessionId) as any;
    if (!session) return res.status(404).json({ error: "Quiz session not found." });
    if (session.user_id !== null && session.user_id !== (req.userId ?? null)) return res.status(403).json({ error: "This quiz belongs to another account." });
    if (session.completed) return res.status(409).json({ error: "This quiz has already been completed." });
    const question = db.prepare("SELECT * FROM quiz_questions WHERE id = ? AND session_id = ?").get(questionId, sessionId) as any;
    if (!question) return res.status(404).json({ error: "Question not found." });
    if (question.answered) return res.status(409).json({ error: "This question has already been answered." });
    const options = JSON.parse(question.options_json) as Array<{ vocabularyId: number; label: string }>;
    if (!options.some(o => o.vocabularyId === selectedVocabularyId)) return res.status(400).json({ error: "Select one of the displayed choices." });
    const correct = selectedVocabularyId === question.correct_vocabulary_id;
    const correctWord = db.prepare("SELECT id, standard, level, hanzi, pinyin, meaning, example_hanzi AS exampleHanzi, example_pinyin AS examplePinyin, example_meaning AS exampleMeaning FROM vocabulary WHERE id = ?").get(question.correct_vocabulary_id) as any;
    const update = db.transaction(() => {
      db.prepare("UPDATE quiz_questions SET answered = 1, selected_vocabulary_id = ?, is_correct = ?, answered_at = datetime('now') WHERE id = ?").run(selectedVocabularyId, correct ? 1 : 0, questionId);
      if (session.user_id !== null) {
        db.prepare("INSERT INTO answer_history (user_id, session_id, question_id, vocabulary_id, selected_vocabulary_id, is_correct) VALUES (?, ?, ?, ?, ?, ?)").run(session.user_id, sessionId, questionId, question.vocabulary_id, selectedVocabularyId, correct ? 1 : 0);
      }
    });
    update();
    res.json({ correct, feedback: {
      correctVocabularyId: correctWord.id, hanzi: correctWord.hanzi, pinyin: correctWord.pinyin, meaning: correctWord.meaning,
      exampleHanzi: correctWord.exampleHanzi, examplePinyin: correctWord.examplePinyin, exampleMeaning: correctWord.exampleMeaning
    }});
  } catch (e) { next(e); }
});

app.post("/api/quizzes/:id/finish", (req: AuthRequest, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    const session = db.prepare("SELECT * FROM quiz_sessions WHERE id = ?").get(sessionId) as any;
    if (!session) return res.status(404).json({ error: "Quiz session not found." });
    if (session.user_id !== null && session.user_id !== (req.userId ?? null)) return res.status(403).json({ error: "This quiz belongs to another account." });
    if (session.completed) return res.json({ sessionId, score: session.score, correct: session.correct_count, total: session.question_count });
    const stats = db.prepare("SELECT COUNT(*) AS answered, COALESCE(SUM(is_correct), 0) AS correct FROM quiz_questions WHERE session_id = ? AND answered = 1").get(sessionId) as any;
    const score = stats.answered ? Math.round(stats.correct / session.question_count * 100) : 0;
    db.prepare("UPDATE quiz_sessions SET completed = 1, correct_count = ?, score = ?, completed_at = datetime('now') WHERE id = ?").run(stats.correct, score, sessionId);
    res.json({ sessionId, score, correct: stats.correct, total: session.question_count, answered: stats.answered });
  } catch (e) { next(e); }
});

app.get("/api/history", requireAuth, (req: AuthRequest, res) => {
  const items = db.prepare("SELECT id, standard, min_level, max_level, direction, question_count, correct_count, score, created_at, completed_at FROM quiz_sessions WHERE user_id = ? AND completed = 1 ORDER BY created_at DESC LIMIT 100").all(req.userId);
  res.json({ items });
});
app.get("/api/stats", requireAuth, (req: AuthRequest, res) => {
  const overall = db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(question_count),0) AS total_questions, COALESCE(SUM(correct_count),0) AS correct FROM quiz_sessions WHERE user_id = ? AND completed = 1`).get(req.userId) as any;
  const answered = db.prepare("SELECT COUNT(*) AS total FROM answer_history WHERE user_id = ?").get(req.userId) as any;
  const byStandard = db.prepare(`SELECT standard, COUNT(*) AS sessions, COALESCE(SUM(question_count),0) AS answered, COALESCE(SUM(correct_count),0) AS correct, CASE WHEN SUM(question_count) > 0 THEN ROUND(100.0 * SUM(correct_count) / SUM(question_count)) ELSE 0 END AS accuracy FROM quiz_sessions WHERE user_id = ? AND completed = 1 GROUP BY standard`).all(req.userId);
  const recent = db.prepare("SELECT standard, min_level, max_level, score, created_at FROM quiz_sessions WHERE user_id = ? AND completed = 1 ORDER BY created_at DESC LIMIT 5").all(req.userId);
  res.json({ sessions: overall.sessions, answered: overall.total_questions, correct: overall.correct, accuracy: overall.total_questions ? Math.round(100 * overall.correct / overall.total_questions) : 0, answerEvents: answered.total, byStandard, recent });
});
app.get("/api/saved", requireAuth, (req: AuthRequest, res) => {
  const items = db.prepare(`SELECT v.id, v.standard, v.level, v.hanzi, v.pinyin, v.meaning, v.example_hanzi AS exampleHanzi, v.example_pinyin AS examplePinyin, v.example_meaning AS exampleMeaning, s.created_at AS savedAt FROM saved_words s JOIN vocabulary v ON v.id = s.vocabulary_id WHERE s.user_id = ? ORDER BY s.created_at DESC`).all(req.userId);
  res.json({ items });
});
app.post("/api/saved/:vocabularyId", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.vocabularyId);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid vocabulary id." });
  const exists = db.prepare("SELECT id FROM vocabulary WHERE id = ?").get(id);
  if (!exists) return res.status(404).json({ error: "Vocabulary word not found." });
  db.prepare("INSERT OR IGNORE INTO saved_words (user_id, vocabulary_id) VALUES (?, ?)").run(req.userId, id);
  res.status(201).json({ ok: true });
});
app.delete("/api/saved/:vocabularyId", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.vocabularyId);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid vocabulary id." });
  db.prepare("DELETE FROM saved_words WHERE user_id = ? AND vocabulary_id = ?").run(req.userId, id);
  res.json({ ok: true });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});
app.listen(port, () => console.log(`HSK quiz API listening at http://localhost:${port}`));
