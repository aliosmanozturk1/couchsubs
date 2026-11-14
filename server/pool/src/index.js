// SPDX-License-Identifier: AGPL-3.0-only
// CouchSubs subtitle pool (Cloudflare Worker + D1).
// POST /v1/lines   : uygulamalar paketlerde bulunmayan İngilizce satırları gönderir. Satırda isteğe bağlı olarak
//                    PS5'te o an çalışan oyunun kimliği (titleId, ör. "PPSA01234") ve adı (game) gelir.
// GET  /v1/export  : (yönetici) en az N kurulumun gördüğü, henüz çevrilmemiş satırlar; `title=` ya da `game=` ile
//                    yalnız bir oyunun satırları.
// POST /v1/exported: (yönetici) çeviriye alınan anahtarları işaretler.
// GET  /v1/stats   : herkese açık sayılar.

import { accepts } from "./filter.js";

const MAX_LINES = 200;
const DAILY_LIMIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG = /<[^<>]{0,40}>/g;
// PS5 oyun kimliği: dört harf, beş rakam, isteğe bağlı "_00" eki (PPSA01234, CUSA00419_00).
const TITLE_ID = /^[A-Z]{4}\d{5}(_\d{2})?$/;
const MAX_GAME = 120;

/** Geçerli PS5 oyun kimliği (büyük harfe çevrilmiş) ya da null. */
export function titleId(value) {
  const t = String(value ?? "").trim().toUpperCase();
  return TITLE_ID.test(t) ? t : null;
}

/** Oyun adı: denetim karakterleri ve fazla boşluk atılır, en çok 120 karakter; boşsa null. */
export function gameName(value) {
  if (typeof value !== "string") return null;
  const t = value.replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_GAME).trim();
  return t || null;
}

// Uygulamadaki anahtar işleviyle birebir aynı (core/.../GamePack, golden-vectors.json).
export function canon(s) {
  let t = s.replace(TAG, " ").normalize("NFKC").toLowerCase().normalize("NFD");
  t = t.replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, " ");
  return t.split(/\s+/).filter(Boolean).join(" ");
}

export async function key(s) {
  const c = canon(s);
  if (!c) return "";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

function isAdmin(req, env) {
  const h = req.headers.get("authorization") || "";
  return env.ADMIN_TOKEN && h === `Bearer ${env.ADMIN_TOKEN}`;
}

async function submit(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "json" }, 400); }
  const install = String(body?.install || "");
  if (!UUID.test(install) || !Array.isArray(body?.lines)) return json({ error: "bad_request" }, 400);
  const lines = body.lines.slice(0, MAX_LINES);
  const day = new Date().toISOString().slice(0, 10);

  const q = await env.DB.prepare("SELECT count FROM quota WHERE install=? AND day=?").bind(install, day).first();
  const used = q?.count || 0;
  if (used >= DAILY_LIMIT) return json({ error: "quota" }, 429, { "retry-after": "3600" });
  const room = Math.min(lines.length, DAILY_LIMIT - used);

  // Türkçe, PS5 sistem yazısı ve yarım okumalar hiç yazılmaz (eski sürümler süzmeden gönderiyor). Aynı istekteki
  // yinelenen anahtar bir kez sayılır.
  const fresh = new Map();
  for (const l of lines.slice(0, room)) {
    const text = String(l?.text || "").trim().replace(/\s+/g, " ");
    if (!accepts(text)) continue;
    const c = canon(text);
    if (c.split(" ").length < 2) continue;
    const k = await key(text); // istemcinin anahtarına güvenmeyiz, yeniden hesaplarız
    // Oyun bilgisi isteğe bağlıdır (eski sürümler göndermez); geçersizse yok sayılır, satır yine alınır.
    if (!fresh.has(k)) fresh.set(k, { text, title: titleId(l?.titleId), game: gameName(l?.game) });
  }

  // D1'in günlük yazma kotası için satır başına en çok iki yazma: önce görülme kaydı; bu kurulum satırı zaten
  // bildirdiyse (changes 0) satıra hiç dokunulmaz. Yeni görülmede sayaç sayılarak değil bir artırılarak güncellenir.
  // Kota satırı istek başına tek yazmadır.
  const now = new Date().toISOString();
  const entries = [...fresh];
  const seen = entries.length
    ? await env.DB.batch(entries.map(([k]) =>
      env.DB.prepare("INSERT OR IGNORE INTO sightings(key,install) VALUES(?,?)").bind(k, install)))
    : [];
  // Oyun bilgisi satırın ilk bilinen oyunudur: sonra gelen başka oyun üstüne yazmaz (COALESCE), ek yazma da yapmaz.
  const build = (legacy) => {
    const stmts = [];
    entries.forEach(([k, line], i) => {
      if (!(seen[i]?.meta?.changes > 0)) return;
      stmts.push(legacy
        ? env.DB.prepare(LEGACY_UPSERT).bind(k, line.text, now, now)
        : env.DB.prepare(UPSERT).bind(k, line.text, now, now, line.title, line.game));
    });
    stmts.push(env.DB.prepare(
      "INSERT INTO quota(install,day,count) VALUES(?,?,?) ON CONFLICT(install,day) DO UPDATE SET count=count+excluded.count"
    ).bind(install, day, room));
    return stmts;
  };
  let stmts = build(false);
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    // Geçiş (migrate-2026-11-14-game.sql) henüz çalışmadıysa oyun sütunları yoktur: eski biçimle yazılır.
    if (!/no such column|has no column/i.test(String(e?.message || e))) throw e;
    stmts = build(true);
    await env.DB.batch(stmts);
  }
  return json({ accepted: fresh.size, recorded: stmts.length - 1 });
}

const UPSERT =
  "INSERT INTO lines(key,text,installs,first_seen,last_seen,title_id,game) VALUES(?,?,1,?,?,?,?) " +
  "ON CONFLICT(key) DO UPDATE SET installs=installs+1, last_seen=excluded.last_seen, " +
  "title_id=COALESCE(lines.title_id,excluded.title_id), game=COALESCE(lines.game,excluded.game)";
const LEGACY_UPSERT =
  "INSERT INTO lines(key,text,installs,first_seen,last_seen) VALUES(?,?,1,?,?) " +
  "ON CONFLICT(key) DO UPDATE SET installs=installs+1, last_seen=excluded.last_seen";

async function exportLines(url, env) {
  const min = Math.max(1, Number(url.searchParams.get("min") || 2));
  const limit = Math.min(20000, Number(url.searchParams.get("limit") || 5000));
  const all = url.searchParams.get("all") === "1";
  // Oyuna göre süzme yalnız geçişten sonra çalışır (title_id ve game sütunları); süzgeçsiz istek eskisi gibi.
  const title = titleId(url.searchParams.get("title"));
  const game = gameName(url.searchParams.get("game"));
  const where = ["installs>=?"];
  const args = [min];
  if (!all) where.push("exported=0");
  if (title) { where.push("title_id=?"); args.push(title); }
  if (game) { where.push("game LIKE ? ESCAPE '\\'"); args.push(`%${game.replace(/[\\%_]/g, "\\$&")}%`); }
  const cols = title || game ? "key,text,installs,first_seen,title_id,game" : "key,text,installs,first_seen";
  const r = await env.DB.prepare(
    `SELECT ${cols} FROM lines WHERE ${where.join(" AND ")} ORDER BY installs DESC LIMIT ?`
  ).bind(...args, limit).all();
  return json({ lines: r.results });
}

async function markExported(req, env) {
  const body = await req.json().catch(() => null);
  const keys = Array.isArray(body?.keys) ? body.keys.slice(0, 20000) : [];
  for (let i = 0; i < keys.length; i += 100) {
    await env.DB.batch(keys.slice(i, i + 100).map((k) =>
      env.DB.prepare("UPDATE lines SET exported=1 WHERE key=?").bind(String(k))));
  }
  return json({ marked: keys.length });
}

async function stats(env) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS lines, SUM(installs>=2) AS confirmed, (SELECT COUNT(DISTINCT install) FROM sightings) AS installs FROM lines"
  ).first();
  return json(r);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (req.method === "POST" && url.pathname === "/v1/lines") return await submit(req, env);
      if (req.method === "GET" && url.pathname === "/v1/stats") return await stats(env);
      if (url.pathname === "/v1/export" || url.pathname === "/v1/exported") {
        if (!isAdmin(req, env)) return json({ error: "unauthorized" }, 401);
        return req.method === "POST" ? await markExported(req, env) : await exportLines(url, env);
      }
      if (url.pathname === "/") return new Response("CouchSubs subtitle pool\n");
      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "server_error" }, 500);
    }
  },
};
