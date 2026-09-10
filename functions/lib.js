// functions/lib.js

export const RESERVED_SLUGS = new Set([
  "favicon.ico", "favicon.svg", "robots.txt", "sitemap.xml",
  "gs", "gs-files"
]);

export const SVG_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="24" fill="#0c110e"/>
  <rect x="2" y="2" width="96" height="96" rx="22" fill="none" stroke="#1f2d24" stroke-width="4"/>
  <path d="M70 32H54C42 32 32 42 32 54C32 66 42 76 54 76H70" fill="none" stroke="#10b981" stroke-width="12" stroke-linecap="round"/>
  <circle cx="68" cy="54" r="7" fill="#34d399"/>
</svg>`;

let dbReady = false;

export async function initDB(db) {
  if (!dbReady) {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS links (slug TEXT PRIMARY KEY, type TEXT DEFAULT 'direct', target_url TEXT, splat INTEGER DEFAULT 1, password TEXT, expires_at INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS hub_configs (slug TEXT PRIMARY KEY, mode TEXT DEFAULT 'builder', title TEXT, bio TEXT, theme_palette TEXT, btn_style TEXT, bg_type TEXT, bg_val TEXT, custom_html TEXT, lang_mode TEXT DEFAULT 'auto', items_json TEXT)`)
    ]);
    dbReady = true;
  }
}

export function authCheck(req, env) {
  if (!env.SITE_TOKEN || env.SITE_TOKEN.trim() === "") return false;
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return false;
  return token === env.SITE_TOKEN;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export function genRandomSlug(len = 6, mode = "alphanumeric") {
  let chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  if (mode === "alpha") chars = "abcdefghijklmnopqrstuvwxyz";
  if (mode === "numeric") chars = "0123456789";
  let res = "";
  for (let i = 0; i < len; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

export function validateSlugFormat(slug) {
  if (!slug) return false;
  return /^[a-z0-9_]+$/.test(slug);
}

// ✅ Solo escribe en Analytics Engine, NO toca D1
export function recordAnalytics(ctx, env, slug, req) {
  const country = req.cf?.country || "XX";
  const ua = req.headers.get("user-agent") || "N/A";
  const referrer = req.headers.get("referer") || "—";
  const isBotScore = req.cf?.botManagement?.score;
  const isBotVerified = req.cf?.botManagement?.verifiedBot;
  const isBot = (isBotVerified || (isBotScore !== undefined && isBotScore < 30) || /bot|crawler|spider|curl|wget/i.test(ua)) ? 1 : 0;

  if (env.ANALYTICS) {
    ctx.waitUntil(
      env.ANALYTICS.writeDataPoint({
        blobs: [slug, country, ua, referrer],
        doubles: [isBot],
        indexes: [slug]
      })
    );
  }
}