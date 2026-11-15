// SPDX-License-Identifier: AGPL-3.0-only
// Ağ yok: süzgeç ve gönderimin D1'e kaç yazma yaptığı sahte bir veritabanıyla denenir. Çalıştırma: `npm test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { accepts } from "../src/filter.js";
import worker, { gameName, titleId } from "../src/index.js";
import { GENERAL, runAutopack } from "../src/autopack.js";

test("Türkçe arayüz, bozulmuş Türkçe, sistem yazısı ve yarım okumalar alınmaz", () => {
  for (const line of [
    "Oturum Açtı", "Oturum Aqtl", "Oturum Aqtl.", "Sifirlama Seqenekleri", "Sifirlama Seqenekleri.",
    "PS5 Sistemini Yeniden Baslat", "PS5 Sistemini Yeniden Baslat.", "Oyunu Kapat", "Ana Ekranda Tut",
    "Lütfen bekleyin..", "Ekran ve Video", "ilerlemenizi takip edin Kupalar", "Keşfet PS5 ile ilgili Öne Çıkanlar",
    "Ekran görüntüsü kaydedildi.", "Kupa kazandınız!", "John signed in.", "You've earned a trophy!",
    "Please do not quit or turn off your console while the Rockstar cloud save icon is showing.",
    "GO to the", "Take out the trash and the", "it Auto V's Story Mode.", "FREE MONTH OF GTA+", "PHOTO MODE SELECT",
    "Main menu", "Hold on", "HP 100/100 MP 25/50", "Okay.",
  ]) assert.equal(accepts(line), false, line);
});

test("İngilizce oyun satırları alınır", () => {
  for (const line of [
    "Herr Müller will see you now.", "This place was designed in a hurry.", "Tell Sam I signed the deal.",
    "I lie to you, you lie to me.", "DON TORRISI WANTS YOU!", "Get down!", "Who's there?", "Line number 7 here",
    "We need to move before the cops show up", "Give me 50 dollars, Enzo.",
  ]) assert.equal(accepts(line), true, line);
});

// D1'in yalnız bu dosyadaki sorguları kadarını taklit eder; her çalışan yazma deyimini sayar.
// `legacy`: geçiş çalışmamış veritabanı (title_id ve game sütunları yok).
function fakeDB({ legacy = false } = {}) {
  const sightings = new Set();
  const lines = new Map();
  const db = { writes: 0, lines, quota: 0, last: null };
  const run = (sql, args) => {
    if (sql.startsWith("SELECT count FROM quota")) return { count: db.quota };
    if (sql.startsWith("SELECT")) {
      db.last = { sql, args };
      return { results: [] };
    }
    db.writes++;
    if (sql.startsWith("INSERT OR IGNORE INTO sightings")) {
      const id = args.join("|");
      const changes = sightings.has(id) ? 0 : 1;
      sightings.add(id);
      return { meta: { changes } };
    }
    if (sql.startsWith("INSERT INTO lines")) {
      const [k, text, , , title = null, game = null] = args;
      const row = lines.get(k);
      lines.set(k, row
        ? { ...row, installs: row.installs + 1, title: row.title ?? title, game: row.game ?? game }
        : { text, installs: 1, title, game });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO quota")) {
      db.quota += args[2];
      return { meta: { changes: 1 } };
    }
    throw new Error(sql);
  };
  db.prepare = (sql) => ({
    bind: (...args) => ({
      first: async () => run(sql, args), run: async () => run(sql, args), all: async () => run(sql, args), sql, args,
    }),
  });
  // D1'de toplu yazma tek işlemdir: bir deyim hata verirse hiçbiri yazılmaz.
  db.batch = async (stmts) => {
    if (legacy && stmts.some((s) => s.sql.includes("title_id"))) throw new Error("D1_ERROR: table lines has no column named title_id");
    return stmts.map((s) => run(s.sql, s.args));
  };
  return db;
}

const install = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const post = (env, who, texts) => worker.fetch(new Request("https://pool.test/v1/lines", {
  method: "POST",
  body: JSON.stringify({ install: who, lines: texts.map((text) => ({ text })) }),
}), env);

test("gönderim süzer ve satır başına en çok iki yazma yapar", async () => {
  const DB = fakeDB();
  const env = { DB };
  const reply = await post(env, install(1), ["Oturum Açtı", "Get down!", "Get down!", "Who is that over there?"]);
  assert.deepEqual(await reply.json(), { accepted: 2, recorded: 2 });
  // 2 görülme + 2 satır + 1 kota.
  assert.equal(DB.writes, 5);
  assert.equal(DB.lines.size, 2);

  // Aynı kurulum aynı satırları yeniden gönderirse yalnız görülme denemesi ve kota yazılır.
  DB.writes = 0;
  await post(env, install(1), ["Get down!", "Who is that over there?"]);
  assert.equal(DB.writes, 3);
  assert.deepEqual([...DB.lines.values()].map((l) => l.installs), [1, 1]);

  // Başka kurulum: sayaç bir artar.
  await post(env, install(2), ["Get down!"]);
  assert.deepEqual([...DB.lines.values()].map((l) => l.installs), [2, 1]);
});

const postLines = (env, who, lines) => worker.fetch(new Request("https://pool.test/v1/lines", {
  method: "POST",
  body: JSON.stringify({ install: who, lines }),
}), env);

test("oyun kimliği ve adı doğrulanır", () => {
  assert.equal(titleId("PPSA01234"), "PPSA01234");
  assert.equal(titleId(" cusa00419_00 "), "CUSA00419_00");
  assert.equal(titleId("PPSA1234"), null);
  assert.equal(titleId("x'; DROP TABLE lines;--"), null);
  assert.equal(titleId(undefined), null);
  assert.equal(gameName("  Grand Theft Auto VI \n"), "Grand Theft Auto VI");
  assert.equal(gameName("A\u0000B"), "A B");
  assert.equal(gameName("x".repeat(300)).length, 120);
  assert.equal(gameName(""), null);
  assert.equal(gameName(42), null);
});

test("satırın oyunu saklanır; ilk bilinen oyun kalır, yazma sayısı artmaz", async () => {
  const DB = fakeDB();
  const env = { DB };
  const reply = await postLines(env, install(1), [
    { text: "Get in the car, Lucia.", titleId: "PPSA12345", game: "Grand Theft Auto VI" },
    { text: "Who is that over there?" },
    { text: "Keep your head down.", titleId: "bogus", game: "" },
  ]);
  assert.deepEqual(await reply.json(), { accepted: 3, recorded: 3 });
  // 3 görülme + 3 satır + 1 kota: oyun bilgisi ek yazma yapmaz.
  assert.equal(DB.writes, 7);
  const rows = [...DB.lines.values()];
  assert.deepEqual(rows.map((r) => [r.title, r.game]), [["PPSA12345", "Grand Theft Auto VI"], [null, null], [null, null]]);

  // Başka kurulum aynı satırı başka oyunla bildirir: sayaç artar, oyun değişmez.
  await postLines(env, install(2), [{ text: "Get in the car, Lucia.", titleId: "CUSA00419", game: "GTA V" }]);
  const first = [...DB.lines.values()][0];
  assert.equal(first.installs, 2);
  assert.equal(first.title, "PPSA12345");
});

test("geçiş çalışmadıysa satırlar eski biçimle yazılır", async () => {
  const DB = fakeDB({ legacy: true });
  const reply = await postLines({ DB }, install(1), [{ text: "Get in the car, Lucia.", titleId: "PPSA12345", game: "GTA VI" }]);
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { accepted: 1, recorded: 1 });
  assert.equal(DB.lines.size, 1);
});

test("dışa aktarma oyuna göre süzülür (yalnız yönetici)", async () => {
  const DB = fakeDB();
  const env = { DB, ADMIN_TOKEN: "t" };
  const get = (query, auth = "Bearer t") => worker.fetch(new Request(`https://pool.test/v1/export?${query}`, {
    headers: { authorization: auth },
  }), env);
  assert.equal((await get("title=PPSA12345", "Bearer x")).status, 401);

  await get("title=ppsa12345&min=1");
  assert.match(DB.last.sql, /title_id=\?/);
  assert.match(DB.last.sql, /SELECT key,text,installs,first_seen,title_id,game/);
  assert.deepEqual(DB.last.args, [1, "PPSA12345", 5000]);

  await get("game=Grand%20Theft_Auto");
  assert.match(DB.last.sql, /game LIKE \? ESCAPE/);
  assert.deepEqual(DB.last.args, [2, "%Grand Theft\\_Auto%", 5000]);

  // Süzgeçsiz istek eski sütunlarla (geçişten önce de çalışır).
  await get("");
  assert.doesNotMatch(DB.last.sql, /title_id|game/);
});

test("oyunu bilinmeyen satırlar ortak pakete sıralanır (oyunu bilinenlerden sonra)", async () => {
  const stored = new Map();
  const env = {
    AI: {},
    PACKS: {
      get: async (name) => (stored.has(name) ? { text: async () => stored.get(name) } : null),
      put: async (name, value) => { stored.set(name, value); },
    },
    DB: {
      prepare: (sql) => ({
        bind: () => ({
          all: async () => ({ results: sql.includes("GROUP BY title_id") ? [{ title_id: "PPSA01234", game: "X", lines: 400 }] : [] }),
          first: async () => (sql.includes("title_id IS NULL") ? { lines: 350 } : null),
        }),
      }),
    },
  };
  const plan = await runAutopack(env, new Date("2026-11-20T03:07:00Z"));
  assert.equal(plan.queued, 2);
  const state = JSON.parse(stored.get("auto/state.json"));
  assert.deepEqual(state.queue.map((t) => t.titleId), ["PPSA01234", GENERAL]);
});
