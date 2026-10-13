import "./styles.css";

type User = { id: number; email: string; username: string };
type Vocabulary = {
  id: number; standard: "HSK2" | "HSK3"; level: number; hanzi: string; pinyin: string;
  meaning: string; exampleHanzi?: string; examplePinyin?: string; exampleMeaning?: string;
};
type QuizQuestion = {
  id: string; vocabularyId: number; direction: "ZH_TO_EN" | "EN_TO_ZH";
  prompt: string; options: { vocabularyId: number; label: string }[];
};
type QuizState = { id: number; standard: string; direction: string; questions: QuizQuestion[]; index: number; answers: Map<string, { selectedId: number; correct: boolean; feedback: any }> };

const app = document.querySelector<HTMLDivElement>("#app")!;
let user: User | null = null;
let activePage = "home";
let selectedStandard = "HSK2";
let minLevel = 1;
let maxLevel = 3;
let direction = "MIXED";
let questionCount = 10;
let quiz: QuizState | null = null;
let busy = false;
let notice = "";
let error = "";
let savedIds = new Set<number>();

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Something went wrong");
  return body as T;
}
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function setMessage(message = "", isError = false) { notice = isError ? "" : message; error = isError ? message : ""; }
function messageHtml() {
  return error ? `<div class="error">${esc(error)}</div>` : notice ? `<div class="notice">${esc(notice)}</div>` : "";
}
function shell(content: string) {
  app.innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">汉</div><div>Hanzi Sprint<small>HSK vocabulary lab</small></div></div>
      <nav class="nav">
        ${navButton("home", "Practice")}${navButton("stats", "Progress")}${navButton("history", "History")}${navButton("saved", "Saved words")}
        ${user ? `<button id="logout-btn" class="ghost">Log out · ${esc(user.username)}</button>` : `<button id="login-nav" class="ghost">Log in</button>`}
      </nav>
    </header>
    <main>${messageHtml()}${content}</main>
    <footer class="footer"><span>汉字 · One word at a time</span><span>HSK 2.0 and HSK 3.0 tracked separately</span></footer>
  </div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => button.addEventListener("click", () => go(button.dataset.nav!)));
  document.querySelector("#login-nav")?.addEventListener("click", () => go("auth"));
  document.querySelector("#logout-btn")?.addEventListener("click", logout);
}
function navButton(page: string, label: string) {
  return `<button data-nav="${page}" class="${activePage === page ? "active" : ""}">${label}</button>`;
}
function levelLimit() { return selectedStandard === "HSK2" ? 6 : 9; }
function levelName(level: number) { return selectedStandard === "HSK2" ? `HSK 2.0 · Level ${level}` : `HSK 3.0 · Level ${level}`; }

async function go(page: string) {
  activePage = page; setMessage();
  if (page === "auth") return renderAuth();
  if (!user && ["stats", "history", "saved"].includes(page)) { activePage = "auth"; return renderAuth(); }
  if (page === "home") return renderHome();
  if (page === "stats") return renderStats();
  if (page === "history") return renderHistory();
  if (page === "saved") return renderSaved();
  if (page === "quiz" && quiz) return renderQuiz();
}
function renderHome() {
  quiz = null;
  const cards = [
    { standard: "HSK2", min: 1, max: 3, title: "HSK 2.0", label: "Traditional six-level standard", range: "Levels 1–3", color: "selected" },
    { standard: "HSK2", min: 4, max: 4, title: "HSK 2.0", label: "Build intermediate fluency", range: "Level 4", color: "" },
    { standard: "HSK3", min: 1, max: 4, title: "HSK 3.0", label: "Newer nine-level framework", range: "Levels 1–4", color: "" },
    { standard: "HSK3", min: 5, max: 6, title: "HSK 3.0", label: "Higher-level practice", range: "Levels 5–6", color: "" }
  ];
  shell(`<section class="hero">
      <div class="hero-copy"><div class="eyebrow">Your daily Chinese practice</div><h1>Small sessions.<br>Big progress.</h1><p>Build character recognition, connect words to meaning, and make pinyin stick. Choose your HSK range and get started.</p><button class="btn primary" id="start-hero">Start a quiz <span>↗</span></button></div>
      <div class="hero-art"><div class="floating one">每日进步 · Daily progress</div><div class="big-hanzi">学习</div><div class="floating two">Learn by doing ✓</div></div>
    </section>
    <div class="section-head"><div><h2>Choose your study range</h2><p>HSK 2.0 and HSK 3.0 levels stay separate.</p></div><span class="pill">Personalized practice</span></div>
    <div class="level-grid">${cards.map((c, i) => `<button class="level-card ${i === 0 && selectedStandard === "HSK2" && minLevel === 1 && maxLevel === 3 ? "selected" : ""}" data-card="${i}"><div class="eyebrow">${c.title}</div><div class="level-num">${c.range}</div><div class="level-label">${c.label}</div></button>`).join("")}</div>
    <div class="section-head"><div><h2>Build your quiz</h2><p>Pick direction, levels, and how many words to practice.</p></div></div>
    <section class="panel">
      <div class="form-grid">
        <div class="field"><label for="standard">HSK standard</label><select id="standard"><option value="HSK2" ${selectedStandard === "HSK2" ? "selected" : ""}>HSK 2.0 · 6 levels</option><option value="HSK3" ${selectedStandard === "HSK3" ? "selected" : ""}>HSK 3.0 · 9 levels</option></select></div>
        <div class="field"><label for="min-level">From level</label><select id="min-level">${Array.from({ length: levelLimit() }, (_, i) => i + 1).map(n => `<option ${n === minLevel ? "selected" : ""} value="${n}">Level ${n}</option>`).join("")}</select></div>
        <div class="field"><label for="max-level">To level</label><select id="max-level">${Array.from({ length: levelLimit() }, (_, i) => i + 1).map(n => `<option ${n === maxLevel ? "selected" : ""} value="${n}">Level ${n}</option>`).join("")}</select></div>
        <div class="field"><label for="count">Question count</label><select id="count">${[10, 20, 30, 50].map(n => `<option ${n === questionCount ? "selected" : ""} value="${n}">${n} questions</option>`).join("")}</select></div>
      </div>
      <div class="field" style="margin-top:16px"><label for="direction">Question direction</label><select id="direction"><option value="MIXED" ${direction === "MIXED" ? "selected" : ""}>Mixed · Chinese ↔ English</option><option value="ZH_TO_EN" ${direction === "ZH_TO_EN" ? "selected" : ""}>Chinese → English meaning</option><option value="EN_TO_ZH" ${direction === "EN_TO_ZH" ? "selected" : ""}>English meaning → Chinese</option></select></div>
      <div class="form-actions"><span class="muted" style="font-size:12px">Pinyin appears after each answer, right or wrong.</span><button class="btn primary" id="start-quiz">Generate quiz →</button></div>
    </section>
    ${!user ? `<div class="section-head"><div><h2>Keep your progress</h2><p>Create an account to save quiz history, difficult words, and statistics across sessions.</p></div><button class="btn" id="create-account">Create account</button></div>` : ""}
    <div class="notice">Starter data note: this project includes a small sample vocabulary set for testing. Import a verified vocabulary list for complete exam coverage.</div>`);
  document.querySelectorAll<HTMLButtonElement>("[data-card]").forEach(btn => btn.addEventListener("click", () => {
    const c = cards[Number(btn.dataset.card)]; selectedStandard = c.standard; minLevel = c.min; maxLevel = c.max; renderHome();
  }));
  document.querySelector("#standard")?.addEventListener("change", (e) => {
    selectedStandard = (e.target as HTMLSelectElement).value; minLevel = 1; maxLevel = Math.min(3, levelLimit()); renderHome();
  });
  document.querySelector("#min-level")?.addEventListener("change", e => { minLevel = Number((e.target as HTMLSelectElement).value); if (maxLevel < minLevel) maxLevel = minLevel; renderHome(); });
  document.querySelector("#max-level")?.addEventListener("change", e => { maxLevel = Number((e.target as HTMLSelectElement).value); if (minLevel > maxLevel) minLevel = maxLevel; renderHome(); });
  document.querySelector("#count")?.addEventListener("change", e => { questionCount = Number((e.target as HTMLSelectElement).value); });
  document.querySelector("#direction")?.addEventListener("change", e => { direction = (e.target as HTMLSelectElement).value; });
  document.querySelector("#start-quiz")?.addEventListener("click", startQuiz);
  document.querySelector("#start-hero")?.addEventListener("click", startQuiz);
  document.querySelector("#create-account")?.addEventListener("click", () => go("auth"));
}
function renderAuth() {
  shell(`<section class="auth-box panel"><div class="eyebrow">Your learning account</div><h1 style="font-size:32px">Welcome to your study desk.</h1><p class="muted">Sign in to save your vocabulary progress, quiz history, and review list.</p>
    <div class="auth-toggle"><button class="btn primary" id="show-login">Log in</button><button class="btn" id="show-register">Create account</button></div>
    <form id="auth-form"><div id="auth-fields"></div><button class="btn primary" id="auth-submit" style="width:100%;margin-top:10px">Log in</button></form>
    <p class="muted" style="font-size:11px">Use a unique password. Your password is securely hashed by the server.</p></section>`);
  let mode: "login" | "register" = "login";
  const fields = document.querySelector("#auth-fields")!;
  const submit = document.querySelector<HTMLButtonElement>("#auth-submit")!;
  const renderFields = () => {
    fields.innerHTML = `${mode === "register" ? `<div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div><div class="field"><label>Username</label><input name="username" autocomplete="username" required minlength="3" maxlength="24" placeholder="Your username"></div>` : `<div class="field"><label>Email or username</label><input name="identifier" autocomplete="username" required placeholder="Email or username"></div>`}<div class="field"><label>Password</label><input name="password" type="password" autocomplete="${mode === "register" ? "new-password" : "current-password"}" required minlength="8" maxlength="128" placeholder="At least 8 characters"></div>`;
    submit.textContent = mode === "register" ? "Create account" : "Log in";
    document.querySelector("#show-login")!.className = mode === "login" ? "btn primary" : "btn";
    document.querySelector("#show-register")!.className = mode === "register" ? "btn primary" : "btn";
  };
  document.querySelector("#show-login")!.addEventListener("click", () => { mode = "login"; renderFields(); });
  document.querySelector("#show-register")!.addEventListener("click", () => { mode = "register"; renderFields(); });
  renderFields();
  document.querySelector<HTMLFormElement>("#auth-form")!.addEventListener("submit", async e => {
    e.preventDefault(); setMessage(); submit.disabled = true;
    const data = Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement).entries()) as Record<string, string>;
    try {
      const result = mode === "register"
        ? await api<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(data) })
        : await api<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(data) });
      user = result.user; activePage = "home"; await loadSavedIds(); renderHome();
    } catch (err) { setMessage((err as Error).message, true); renderAuth(); }
    finally { submit.disabled = false; }
  });
}
async function startQuiz() {
  setMessage();
  const startButton = document.querySelector<HTMLButtonElement>("#start-quiz") || document.querySelector<HTMLButtonElement>("#start-hero");
  if (startButton) { startButton.disabled = true; startButton.textContent = "Preparing…"; }
  try {
    const result = await api<{ quiz: { id: number; standard: string; direction: string }; questions: QuizQuestion[] }>("/quizzes", {
      method: "POST",
      body: JSON.stringify({ standard: selectedStandard, minLevel, maxLevel, direction, questionCount })
    });
    quiz = { ...result.quiz, questions: result.questions, index: 0, answers: new Map() };
    activePage = "quiz"; renderQuiz();
  } catch (err) { setMessage((err as Error).message, true); renderHome(); }
}
function renderQuiz() {
  if (!quiz) return renderHome();
  const q = quiz.questions[quiz.index];
  if (!q) return finishQuiz();
  const answer = quiz.answers.get(q.id);
  const current = quiz.index + 1;
  shell(`<div class="quiz-wrap">
    <div class="quiz-top"><button class="btn ghost" id="quit-quiz">← Exit quiz</button><span class="pill">${esc(quiz.standard)} · ${esc(quiz.direction === "MIXED" ? "Mixed practice" : quiz.direction === "ZH_TO_EN" ? "Chinese → English" : "English → Chinese")}</span></div>
    <div class="quiz-top"><span class="muted" style="font-size:12px">QUESTION ${current} OF ${quiz.questions.length}</span><strong>${Math.round((current - 1) / quiz.questions.length * 100)}%</strong></div>
    <div class="progress"><span style="width:${(current - 1) / quiz.questions.length * 100}%"></span></div>
    <section class="panel question-card">
      <div class="question-kicker">${q.direction === "ZH_TO_EN" ? "Choose the correct meaning" : "Choose the matching Chinese word"}</div>
      <div class="question-main ${q.direction === "EN_TO_ZH" ? "english" : ""}">${esc(q.prompt)}</div>
      <div class="option-grid">${q.options.map((opt, i) => {
        const selected = answer?.selectedId === opt.vocabularyId;
        const correct = answer?.feedback?.correctVocabularyId === opt.vocabularyId;
        const cls = answer && correct ? "correct" : answer && selected && !answer.correct ? "wrong" : "";
        return `<button class="option ${cls}" data-option="${opt.vocabularyId}" ${answer ? "disabled" : ""}><span class="letter">${String.fromCharCode(65 + i)}</span><span>${esc(opt.label)}</span></button>`;
      }).join("")}</div>
      ${answer ? `<div class="feedback ${answer.correct ? "" : "bad"}"><div><strong>${answer.correct ? "Nice work!" : "Keep going — you'll learn it."}</strong></div><div class="answer">${esc(answer.feedback.hanzi)}</div><div class="pinyin">${esc(answer.feedback.pinyin)}</div><p><strong>Meaning:</strong> ${esc(answer.feedback.meaning)}</p>${answer.feedback.exampleHanzi ? `<p><strong>Example:</strong> ${esc(answer.feedback.exampleHanzi)}<br><span class="muted">${esc(answer.feedback.examplePinyin || "")}</span><br>${esc(answer.feedback.exampleMeaning || "")}</p>` : ""}${user ? `<div style="margin-top:12px"><button class="btn" id="save-current-word" ${savedIds.has(answer.feedback.correctVocabularyId) ? "disabled" : ""}>${savedIds.has(answer.feedback.correctVocabularyId) ? "✓ Saved to word bank" : "＋ Save word for review"}</button></div>` : `<p class="muted" style="font-size:11px">Log in to save this word for review.</p>`}</div>` : ""}
      <div class="quiz-bottom"><span class="muted" style="font-size:12px">${quiz.answers.size} answered</span>${answer ? `<button class="btn primary" id="next-question">${current === quiz.questions.length ? "Finish quiz" : "Next question →"}</button>` : `<span class="muted" style="font-size:12px">Select one answer</span>`}</div>
    </section>
  </div>`);
  document.querySelector("#quit-quiz")!.addEventListener("click", () => { quiz = null; go("home"); });
  document.querySelectorAll<HTMLButtonElement>("[data-option]").forEach(button => button.addEventListener("click", () => submitAnswer(Number(button.dataset.option))));
  document.querySelector("#save-current-word")?.addEventListener("click", async () => {
    const currentAnswer = quiz?.answers.get(q.id);
    if (!currentAnswer || !user) return;
    const saveButton = document.querySelector<HTMLButtonElement>("#save-current-word");
    if (saveButton) saveButton.disabled = true;
    try {
      await api(`/saved/${currentAnswer.feedback.correctVocabularyId}`, { method: "POST", body: "{}" });
      savedIds.add(currentAnswer.feedback.correctVocabularyId);
      if (saveButton) saveButton.textContent = "✓ Saved to word bank";
    } catch (err) {
      setMessage((err as Error).message, true);
      if (saveButton) saveButton.disabled = false;
    }
  });
  document.querySelector("#next-question")?.addEventListener("click", () => {
    if (!quiz) return;
    if (quiz.index === quiz.questions.length - 1) finishQuiz();
    else { quiz.index++; renderQuiz(); }
  });
}
async function submitAnswer(selectedVocabularyId: number) {
  if (!quiz) return;
  const q = quiz.questions[quiz.index];
  try {
    const result = await api<{ correct: boolean; feedback: any }>(`/quizzes/${quiz.id}/answer`, {
      method: "POST", body: JSON.stringify({ questionId: q.id, selectedVocabularyId })
    });
    quiz.answers.set(q.id, { selectedId: selectedVocabularyId, correct: result.correct, feedback: result.feedback });
    renderQuiz();
  } catch (err) { setMessage((err as Error).message, true); renderQuiz(); }
}
async function finishQuiz() {
  if (!quiz) return;
  const oldQuiz = quiz;
  try {
    const result = await api<{ score: number; correct: number; total: number; sessionId: number }>(`/quizzes/${oldQuiz.id}/finish`, { method: "POST", body: "{}" });
    quiz = null; activePage = "result";
    shell(`<section class="auth-box panel" style="max-width:620px;text-align:center"><div class="eyebrow">Session complete</div><h1 style="font-size:34px">Good work. 继续加油!</h1><div class="question-main">${result.score}%</div><p class="muted">You answered ${result.correct} of ${result.total} questions correctly.</p><div class="progress"><span style="width:${result.score}%"></span></div><div class="form-actions" style="justify-content:center"><button class="btn" id="review-history">View history</button><button class="btn primary" id="again">Practice again →</button></div></section>`);
    document.querySelector("#review-history")!.addEventListener("click", () => go("history"));
    document.querySelector("#again")!.addEventListener("click", () => go("home"));
  } catch (err) { setMessage((err as Error).message, true); quiz = null; go("home"); }
}
async function loadSavedIds() {
  if (!user) return;
  try { const result = await api<{ items: Vocabulary[] }>("/saved"); savedIds = new Set(result.items.map(item => item.id)); } catch { /* user can retry later */ }
}
async function renderStats() {
  try {
    const s = await api<{ sessions: number; answered: number; correct: number; accuracy: number; recent: any[]; byStandard: any[] }>("/stats");
    shell(`<div class="eyebrow">Your learning analytics</div><h1>Your progress, at a glance.</h1><p class="muted">Small consistent sessions are how vocabulary becomes recall.</p>
      <div class="stats-grid" style="margin-top:24px">
        <div class="stat"><div class="stat-icon">◷</div><div class="value">${s.sessions}</div><div class="label">Completed quizzes</div></div>
        <div class="stat"><div class="stat-icon">字</div><div class="value">${s.answered}</div><div class="label">Questions answered</div></div>
        <div class="stat"><div class="stat-icon">✓</div><div class="value">${s.correct}</div><div class="label">Correct answers</div></div>
        <div class="stat"><div class="stat-icon">↗</div><div class="value">${s.accuracy}%</div><div class="label">Overall accuracy</div></div>
      </div>
      <div class="two-col" style="margin-top:22px"><section class="panel"><h2>By HSK standard</h2><div class="list">${s.byStandard.length ? s.byStandard.map((x: any) => `<div class="list-row"><div><strong>${esc(x.standard === "HSK2" ? "HSK 2.0" : "HSK 3.0")}</strong><div class="word-detail">${x.correct}/${x.answered} correct</div></div><span class="pill">${x.accuracy}%</span></div>`).join("") : `<div class="empty">Finish a quiz to see your breakdown.</div>`}</div></section>
      <section class="panel"><h2>Recent activity</h2><div class="list">${s.recent.length ? s.recent.map((x: any) => `<div class="list-row"><div><strong>${esc(x.standard)} · Levels ${x.min_level}–${x.max_level}</strong><div class="word-detail">${new Date(x.created_at).toLocaleDateString()}</div></div><span class="pill">${x.score}%</span></div>`).join("") : `<div class="empty">No completed quizzes yet.</div>`}</div></section></div>`);
  } catch (err) { setMessage((err as Error).message, true); shell(`<div class="empty">Could not load statistics.</div>`); }
}
async function renderHistory() {
  try {
    const result = await api<{ items: any[] }>("/history");
    shell(`<div class="eyebrow">Your past sessions</div><h1>Quiz history</h1><p class="muted">See what you've practiced and how you did.</p><section class="panel" style="margin-top:24px"><div class="list">${result.items.length ? result.items.map((x: any) => `<div class="list-row"><div><strong>${esc(x.standard === "HSK2" ? "HSK 2.0" : "HSK 3.0")} · Levels ${x.min_level}–${x.max_level}</strong><div class="word-detail">${esc(x.direction)} · ${new Date(x.created_at).toLocaleString()} · ${x.correct_count}/${x.question_count} correct</div></div><span class="pill">${x.score}%</span></div>`).join("") : `<div class="empty">No history yet. Complete your first quiz to see it here.</div>`}</div></section>`);
  } catch (err) { setMessage((err as Error).message, true); shell(`<div class="empty">Could not load history.</div>`); }
}
async function renderSaved() {
  try {
    const result = await api<{ items: Vocabulary[] }>("/saved");
    savedIds = new Set(result.items.map(x => x.id));
    shell(`<div class="eyebrow">Your personal word bank</div><h1>Saved words</h1><p class="muted">Save tricky vocabulary during review and come back to it later.</p><section class="panel" style="margin-top:24px"><div class="list">${result.items.length ? result.items.map(x => `<div class="list-row"><div><div class="word">${esc(x.hanzi)}</div><div class="word-detail">${esc(x.pinyin)} · ${esc(x.meaning)}</div><span class="pill">${esc(x.standard)} · Level ${x.level}</span></div><button class="btn danger" data-unsave="${x.id}">Remove</button></div>`).join("") : `<div class="empty">No saved words yet. After answering a question, you can save it for review.</div>`}</div></section>`);
    document.querySelectorAll<HTMLButtonElement>("[data-unsave]").forEach(btn => btn.addEventListener("click", async () => {
      try { await api(`/saved/${btn.dataset.unsave}`, { method: "DELETE" }); renderSaved(); } catch (err) { setMessage((err as Error).message, true); }
    }));
  } catch (err) { setMessage((err as Error).message, true); shell(`<div class="empty">Could not load saved words.</div>`); }
}
async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } finally { user = null; savedIds.clear(); activePage = "home"; renderHome(); }
}
async function init() {
  try { const result = await api<{ user: User | null }>("/auth/me"); user = result.user; if (user) await loadSavedIds(); } catch { user = null; }
  renderHome();
}
init();
