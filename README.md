# HSK Vocabulary Quiz

A runnable full-stack starter project built with Vite + vanilla TypeScript, Node.js + Express + TypeScript, and SQLite.

## Features

- Separate HSK 2.0 and HSK 3.0 vocabulary namespaces.
- Filter quizzes by standard, level range, direction, and question count.
- Chinese → English and English → Chinese multiple-choice questions.
- Correct-answer feedback includes pinyin, meaning, and an optional example.
- Email + username registration/login; passwords hashed with bcrypt.
- JWT stored in an HttpOnly cookie, rate-limited auth endpoints, Helmet headers.
- Quiz history, answer history, saved words, and progress statistics.
- Seed dataset with a small set of clearly marked starter/example entries.
- Responsive UI; the frontend does not need a framework.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Run locally

1. Extract the project and open a terminal in the `hsk-quiz` directory.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `backend/.env` from `.env.example`. Set `JWT_SECRET` to a long random secret (32+ characters). For example, generate one with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Create the database and seed starter vocabulary:

   ```bash
   npm run seed
   ```

5. Start the frontend and backend:

   ```bash
   npm run dev
   ```

6. Open the Vite URL printed in the terminal (usually http://localhost:5173).

The Vite development server proxies `/api` requests to the Express server on port 3000. SQLite is created at `backend/data/hsk-quiz.sqlite` by default.

## Production build

```bash
npm run build
npm start
```

The backend serves `backend/dist` only as its API in this starter. Host the frontend `frontend/dist` with a static web server and configure `/api` to proxy to the backend, or add a static-file serving layer before deployment. Set `NODE_ENV=production`, `COOKIE_SECURE=true` when using HTTPS, and use a strong unique `JWT_SECRET`.

## HSK data note

The bundled seed is deliberately small and is **not a complete official HSK word list**. HSK 2.0 and HSK 3.0 are stored separately because level assignments can differ. Before exam use, import a vocabulary dataset that you have permission to use and verify each entry against the chosen official standard. Avoid combining the two standards into one level namespace.

Vocabulary JSON import format:

```json
[
  {
    "standard": "HSK2",
    "level": 1,
    "hanzi": "你好",
    "pinyin": "nǐ hǎo",
    "meaning": "hello; hi",
    "exampleHanzi": "你好！",
    "examplePinyin": "Nǐ hǎo!",
    "exampleMeaning": "Hello!"
  }
]
```

Run the importer:

```bash
npm --workspace backend run import-vocab -- ./path/to/vocabulary.json
```

Allowed standards: `HSK2` (traditional six-level HSK 2.0) and `HSK3` (nine-level HSK 3.0). Levels must be 1–6 for HSK2 and 1–9 for HSK3.

## API overview

- `POST /api/auth/register` — `{ email, username, password }`
- `POST /api/auth/login` — `{ identifier, password }` where identifier is email or username
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/vocabulary?standard=HSK2&minLevel=1&maxLevel=3`
- `POST /api/quizzes` — `{ standard, minLevel, maxLevel, direction, questionCount }`
- `POST /api/quizzes/:id/answer` — `{ questionId, selectedVocabularyId }`
- `POST /api/quizzes/:id/finish`
- `GET /api/history`
- `GET /api/stats`
- `GET /api/saved`
- `POST /api/saved/:vocabularyId`
- `DELETE /api/saved/:vocabularyId`

## Security / production checklist

This is a local-development starter, not a security audit. Before public deployment, use HTTPS, set a secure cookie, rotate secrets, add email verification/password reset, consider CSRF protections for your deployment topology, back up SQLite, monitor auth abuse, and run dependency/security scans. Do not commit `.env` or the database file.

## Tests / quick check

After starting, register a new account, choose a standard and range with available seed words, start a quiz, answer a question, finish the quiz, then check History, Statistics, and Saved Words. With the included starter data, only the seeded levels have vocabulary.
