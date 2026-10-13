import fs from "node:fs";
import { db } from "./db.js";
import type { SeedWord } from "./seed-data.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm --workspace backend run import-vocab -- ./vocabulary.json");
  process.exit(1);
}
const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
const insert = db.prepare(`
INSERT INTO vocabulary (standard, level, hanzi, pinyin, meaning, example_hanzi, example_pinyin, example_meaning, source_note)
VALUES (@standard, @level, @hanzi, @pinyin, @meaning, @exampleHanzi, @examplePinyin, @exampleMeaning, @sourceNote)
ON CONFLICT(standard, hanzi, pinyin) DO UPDATE SET level=excluded.level, meaning=excluded.meaning,
example_hanzi=excluded.example_hanzi, example_pinyin=excluded.example_pinyin, example_meaning=excluded.example_meaning
`);
let count = 0;
const tx = db.transaction((items: SeedWord[]) => {
  for (const w of items) {
    if (!["HSK2", "HSK3"].includes(w.standard) || !Number.isInteger(w.level) ||
      w.level < 1 || w.level > (w.standard === "HSK2" ? 6 : 9) ||
      !w.hanzi?.trim() || !w.pinyin?.trim() || !w.meaning?.trim()) {
      throw new Error(`Invalid vocabulary row: ${JSON.stringify(w)}`);
    }
    insert.run({ ...w, exampleHanzi: w.exampleHanzi ?? null, examplePinyin: w.examplePinyin ?? null, exampleMeaning: w.exampleMeaning ?? null, sourceNote: "imported vocabulary; source should be verified" });
    count++;
  }
});
tx(rows as SeedWord[]);
console.log(`Imported ${count} vocabulary rows from ${file}.`);
db.close();
