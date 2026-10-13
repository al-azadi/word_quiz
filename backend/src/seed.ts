import { db } from "./db.js";
import { seedWords } from "./seed-data.js";

const insert = db.prepare(`
INSERT INTO vocabulary (standard, level, hanzi, pinyin, meaning, example_hanzi, example_pinyin, example_meaning, source_note)
VALUES (@standard, @level, @hanzi, @pinyin, @meaning, @exampleHanzi, @examplePinyin, @exampleMeaning, @sourceNote)
ON CONFLICT(standard, hanzi, pinyin) DO UPDATE SET
  level=excluded.level, meaning=excluded.meaning,
  example_hanzi=excluded.example_hanzi, example_pinyin=excluded.example_pinyin,
  example_meaning=excluded.example_meaning
`);
const tx = db.transaction(() => {
  for (const word of seedWords) insert.run({ ...word, exampleHanzi: word.exampleHanzi ?? null, examplePinyin: word.examplePinyin ?? null, exampleMeaning: word.exampleMeaning ?? null, sourceNote: "starter sample; verify against official list before exam use" });
});
tx();
console.log(`Seeded ${seedWords.length} starter vocabulary entries.`);
db.close();
