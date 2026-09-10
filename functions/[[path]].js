// functions/[[path]].js

import { RESERVED_SLUGS, SVG_FAVICON, initDB, authCheck, json, genRandomSlug, validateSlugFormat, recordAnalytics } from './lib.js';

export async function onRequest(context) {
  try {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const prefix = segments[0]?.toLowerCase() || "";

    const MAX_SLUG_LENGTH = parseInt(env.MAX_SLUG_LENGTH) || 20;
    const MAX_EXPIRATION_DAYS = parseInt(env.MAX_EXPIRATION_DAYS) || 365;
    const MAX_EXPIRATION_MS = MAX_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

    if (url.pathname === "/favicon.svg") {
      return new Response(SVG_FAVICON, { headers: { "Content-Type": "image/svg+xml" } });
    }

    if (prefix === "gs") return next();
    if (prefix === "gs-files") return next();

    if (prefix === "api") {
      await initDB(env.DB);
      if (!authCheck(request, env)) return json({ error: "Unauthorized" }, 401);
      const action = segments[1];

      if (action === "config" && request.method === "GET") {
        return json({ maxSlugLength: MAX_SLUG_LENGTH, maxExpirationDays: MAX_EXPIRATION_DAYS });
      }

      if (action === "storage" && request.method === "GET") {
        if (!env.CF_ACCOUNT_ID || !env.CF_D1_ID || !env.CF_API_TOKEN) {
          return json({ error: "Variables CF_ACCOUNT_ID, CF_D1_ID y CF_API_TOKEN requeridas" }, 400);
        }
        try {
          const cfRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${env.CF_D1_ID}`,
            { headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" } }
          );
          const cfData = await cfRes.json();
          if (!cfRes.ok || !cfData.success) return json({ error: cfData.errors?.[0]?.message || "Error" }, 500);
          const sizeBytes = cfData.result?.file_size || 0;
          const usedMB = (sizeBytes / (1024 * 1024)).toFixed(2);
          const freeMB = Math.max(0, 5120 - parseFloat(usedMB)).toFixed(2);
          return json({ usedMB, freeMB, totalMB: 5120 });
        } catch {
          return json({ error: "Fallo de conexión" }, 500);
        }
      }

      if (action === "links" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT slug, type, target_url, splat, password, expires_at, created_at FROM links ORDER BY created_at DESC"
        ).all();

        let clicksMap = {};
        if (env.ANALYTICS && env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
          try {
            const query = `SELECT blob1 AS slug, count() AS clicks FROM greenshort GROUP BY slug`;
            const aeRes = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
              { method: "POST", headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` }, body: query }
            );
            const aeData = await aeRes.json();
            if (aeRes.ok && aeData.data) {
              for (const row of aeData.data) {
                clicksMap[row.slug] = Number(row.clicks) || 0;
              }
            }
          } catch (e) {
            console.error("Error obteniendo clics:", e);
          }
        }

        const enriched = results.map(l => ({ ...l, clicks: clicksMap[l.slug] || 0 }));
        return json(enriched);
      }

      if (action === "hub-config" && request.method === "GET") {
        const hubSlug = url.searchParams.get("slug");
        const config = await env.DB.prepare(`
          SELECT h.slug, h.mode, h.title, h.bio, h.theme_palette, h.btn_style,
                 h.bg_type, h.bg_val, h.custom_html, h.lang_mode, h.items_json,
                 l.password
          FROM hub_configs h
          LEFT JOIN links l ON l.slug = h.slug
          WHERE h.slug = ?
        `).bind(hubSlug).first();
        return json(config || {});
      }

      if (action === "ai-slug" && request.method === "POST") {
        const { targetUrl, desiredLength } = await request.json();
        if (!targetUrl) return json({ error: "Falta URL" }, 400);
        if (!env.AI) return json({ error: "Binding 'AI' no encontrado" }, 400);

        const slugLength = Math.max(3, Math.min(parseInt(desiredLength) || 6, MAX_SLUG_LENGTH));
        const minLen = Math.max(3, slugLength - 2);

        let contextText = "";
        try {
          const targetObj = new URL(targetUrl);
          contextText = `Domain: ${targetObj.hostname} Path: ${targetObj.pathname.replace(/[\/-]/g, " ")}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(targetUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36" },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const html = await res.text();
            const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
            const desc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] || "";
            if (title || desc) contextText = `Title: ${title}. Description: ${desc}`;
          }
        } catch {}

        const model = env.AI_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
        const messages = [
          {
            role: "system",
            content: `You are a URL slug generator. Given content, output ONE slug.\n\nSTRICT RULES:\n- Do NOT repeat or echo the input\n- Do NOT include the domain name in the slug\n- Output ONLY lowercase ASCII letters (a-z), numbers (0-9) and underscores (_)\n- Length between ${minLen} and ${slugLength} characters\n- No spaces, no accents, no special characters, no quotes, no punctuation\n- If the content is about a well-known brand or topic, use its common English name\n- Respond ONLY with the slug, nothing else. No explanations, no greetings, no markdown.\n\nExample:\nInput: "Title: GitHub - Build software better, together"\nOutput: github`
          },
          { role: "user", content: contextText.slice(0, 400) || targetUrl }
        ];

        let aiRes;
        try {
          aiRes = await env.AI.run(model, { messages });
        } catch (err) {
          const fallback = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
          if (model !== fallback) {
            try {
              aiRes = await env.AI.run(fallback, { messages });
            } catch (e2) {
              return json({ error: "Error en Workers AI: " + (e2.message || "Fallo interno") }, 500);
            }
          } else {
            return json({ error: "Error en Workers AI: " + (err.message || "Fallo interno") }, 500);
          }
        }

        let cleanSlug = (aiRes.response || "")
          .trim()
          .toLowerCase()
          .replace(/["'`\n\r]/g, "")
          .replace(/[^a-z0-9_]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "");

        try {
          const hostname = new URL(targetUrl).hostname.replace(/^www\./, "").split(".")[0];
          if (hostname.length > 3 && cleanSlug.includes(hostname)) {
            cleanSlug = cleanSlug.replace(new RegExp(hostname, "g"), "").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
          }
        } catch {}

        if (!cleanSlug || cleanSlug.length < 3) cleanSlug = genRandomSlug(slugLength, "alphanumeric");

        if (cleanSlug.length > slugLength) {
          cleanSlug = cleanSlug.slice(0, slugLength).replace(/_+$/g, "");
        }
        if (cleanSlug.length < slugLength) {
          cleanSlug = cleanSlug + genRandomSlug(slugLength - cleanSlug.length, "alphanumeric");
        }

        return json({ slug: cleanSlug.slice(0, MAX_SLUG_LENGTH) });
      }

      if (action === "create" && request.method === "POST") {
        const body = await request.json();
        let { slug, targetUrl, splat, length, mode, password, expAmount, expUnit } = body;
        if (!slug) slug = genRandomSlug(parseInt(length) || 6, mode || "alphanumeric");
        slug = slug.trim().toLowerCase().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
        if (slug.length > MAX_SLUG_LENGTH) return json({ error: `Slug máximo ${MAX_SLUG_LENGTH} caracteres` }, 400);
        if (!validateSlugFormat(slug)) return json({ error: "Slug solo puede tener letras, números, guion bajo (_) y barra (/). No puede empezar ni terminar con / ni tener // consecutivos" }, 400);
        if (RESERVED_SLUGS.has(slug.split("/")[0])) return json({ error: "Ruta reservada" }, 400);
        if (!targetUrl) return json({ error: "Falta la URL de destino" }, 400);
        try { new URL(targetUrl); } catch { return json({ error: "URL inválida" }, 400); }

        // Verificar conflicto con subrutas existentes
        const conflict = await env.DB.prepare(
          "SELECT slug FROM links WHERE slug LIKE ? OR slug = ?"
        ).bind(slug + "/%", slug).first();
        if (conflict && conflict.slug !== slug) {
          return json({ error: "Conflicto con una ruta existente: /" + conflict.slug }, 400);
        }

        // Verificar si un slug padre con splat captura esta ruta
        const parts = slug.split("/");
        for (let i = 1; i < parts.length; i++) {
          const parentSlug = parts.slice(0, i).join("/");
          const parent = await env.DB.prepare("SELECT slug, splat FROM links WHERE slug = ?").bind(parentSlug).first();
          if (parent && parent.splat === 1) {
            return json({ error: "Conflicto: /" + parentSlug + " ya captura esta ruta con splat activado" }, 400);
          }
        }

        let expiresAtTimestamp = null;
        if (expUnit !== 'never' && expAmount && parseInt(expAmount) > 0) {
          const mult = { minutes: 60000, hours: 3600000, days: 86400000 };
          const requestedMs = parseInt(expAmount) * (mult[expUnit] || 60000);
          expiresAtTimestamp = Date.now() + Math.min(requestedMs, MAX_EXPIRATION_MS);
        }
        await env.DB.prepare(`INSERT INTO links (slug, type, target_url, splat, password, expires_at) VALUES (?, 'direct', ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET type='direct', target_url=excluded.target_url, splat=excluded.splat, password=excluded.password, expires_at=CASE WHEN excluded.expires_at IS NOT NULL THEN excluded.expires_at ELSE links.expires_at END`).bind(slug, targetUrl, splat ? 1 : 0, password?.trim() || null, expiresAtTimestamp).run();
        return json({ success: true, slug });
      }

      if (action === "save-hub" && request.method === "POST") {
        const body = await request.json();
        let { slug, mode, title, bio, theme_palette, btn_style, bg_type, bg_val, custom_html, lang_mode, items, password } = body;
        slug = (slug || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
        if (!slug) return json({ error: "Slug requerido" }, 400);
        if (slug.length > MAX_SLUG_LENGTH) return json({ error: `Slug máximo ${MAX_SLUG_LENGTH} caracteres` }, 400);
        if (!validateSlugFormat(slug)) return json({ error: "Slug solo puede tener letras, números, guion bajo (_) y barra (/). No puede empezar ni terminar con / ni tener // consecutivos" }, 400);
        if (RESERVED_SLUGS.has(slug.split("/")[0])) return json({ error: "Ruta reservada" }, 400);

        const conflict = await env.DB.prepare(
          "SELECT slug FROM links WHERE slug LIKE ? OR slug = ?"
        ).bind(slug + "/%", slug).first();
        if (conflict && conflict.slug !== slug) {
          return json({ error: "Conflicto con una ruta existente: /" + conflict.slug }, 400);
        }

        const parts = slug.split("/");
        for (let i = 1; i < parts.length; i++) {
          const parentSlug = parts.slice(0, i).join("/");
          const parent = await env.DB.prepare("SELECT slug, splat FROM links WHERE slug = ?").bind(parentSlug).first();
          if (parent && parent.splat === 1) {
            return json({ error: "Conflicto: /" + parentSlug + " ya captura esta ruta con splat activado" }, 400);
          }
        }

        await env.DB.batch([
          env.DB.prepare(`INSERT INTO links (slug, type, target_url, splat, password) VALUES (?, 'group', '', 0, ?) ON CONFLICT(slug) DO UPDATE SET type='group', password=excluded.password`).bind(slug, password?.trim() || null),
          env.DB.prepare(`INSERT INTO hub_configs (slug, mode, title, bio, theme_palette, btn_style, bg_type, bg_val, custom_html, lang_mode, items_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET mode=excluded.mode, title=excluded.title, bio=excluded.bio, theme_palette=excluded.theme_palette, btn_style=excluded.btn_style, bg_type=excluded.bg_type, bg_val=excluded.bg_val, custom_html=excluded.custom_html, lang_mode=excluded.lang_mode, items_json=excluded.items_json`).bind(
            slug, mode || "builder", title || slug, bio || "", theme_palette || "emerald",
            btn_style || "rounded", bg_type || "palette", bg_val || "",
            custom_html || "", lang_mode || "auto", JSON.stringify(items || [])
          )
        ]);
        return json({ success: true, slug });
      }

      if (action === "delete" && request.method === "POST") {
        const body = await request.json();
        const slugs = Array.isArray(body.slugs) ? body.slugs : (body.slug ? [body.slug] : []);
        if (slugs.length === 0) return json({ error: "No hay slugs" }, 400);
        const statements = [];
        for (const slug of slugs) {
          statements.push(env.DB.prepare("DELETE FROM links WHERE slug = ?").bind(slug));
          statements.push(env.DB.prepare("DELETE FROM hub_configs WHERE slug = ?").bind(slug));
        }
        await env.DB.batch(statements);
        return json({ success: true, count: slugs.length });
      }

      if (action === "analytics" && request.method === "GET") {
        if (!env.ANALYTICS) return json({ error: "Analytics Engine binding 'ANALYTICS' no configurado" }, 400);
        if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return json({ error: "Variables CF_ACCOUNT_ID y CF_API_TOKEN requeridas" }, 400);
        try {
          const query = `SELECT blob1 AS slug, blob2 AS country, blob3 AS user_agent, double1 AS is_bot, timestamp FROM greenshort ORDER BY timestamp DESC LIMIT 150`;
          const aeRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
            { method: "POST", headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` }, body: query }
          );
          const aeData = await aeRes.json();
          if (!aeRes.ok) return json({ error: aeData.errors?.[0]?.message || "Error" }, 500);
          const rows = (aeData.data || []).map(r => ({
            slug: r.slug, country: r.country, user_agent: r.user_agent, is_bot: r.is_bot, created_at: r.timestamp
          }));
          return json(rows);
        } catch (e) {
          return json({ error: "Fallo: " + (e.message || "Error") }, 500);
        }
      }

      if (action === "flow" && request.method === "GET") {
        if (!env.ANALYTICS) return json({ error: "Analytics Engine binding 'ANALYTICS' no configurado" }, 400);
        if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return json({ error: "Variables CF_ACCOUNT_ID y CF_API_TOKEN requeridas" }, 400);
        const limit = parseInt(url.searchParams.get("limit")) || 100;
        const onlyHumans = url.searchParams.get("humans") === "true";
        try {
          let query = `SELECT blob1 AS slug, blob2 AS country, blob3 AS user_agent, blob4 AS referrer, double1 AS is_bot, timestamp FROM greenshort ${onlyHumans ? "WHERE double1 = 0" : ""} ORDER BY timestamp DESC LIMIT ${limit}`;
          const aeRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
            { method: "POST", headers: { "Authorization": `Bearer ${env.CF_API_TOKEN}` }, body: query }
          );
          const aeData = await aeRes.json();
          if (!aeRes.ok) return json({ error: aeData.errors?.[0]?.message || "Error" }, 500);
          const rows = (aeData.data || []).map(r => ({
            slug: r.slug, country: r.country, user_agent: r.user_agent, referrer: r.referrer, is_bot: r.is_bot, timestamp: r.timestamp
          }));
          return json(rows);
        } catch (e) {
          return json({ error: "Fallo: " + (e.message || "Error") }, 500);
        }
      }

      return json({ error: "Not found" }, 404);
    }

    if (!prefix) return Response.redirect(`${url.origin}/gs/dashboard`, 302);

    await initDB(env.DB);

    // ✅ Buscar el slug MÁS LARGO posible que exista en la DB
    // Ej: /git/q/extra
    //   - Prueba "git/q/extra" → no existe
    //   - Prueba "git/q" → existe ✅ → matchedSlug = "git/q", remaining = ["extra"]
    //   - Si "git/q" no tuviera splat, no se usaría para /extra, pero como es el match más largo,
    //     se sigue usando "git/q" y se ignora "extra" (a menos que tenga splat)
    //   - El splat solo decide si se concatena el resto al destino
    let link = null;
    let matchedSlug = "";
    let matchedSegments = 0;
    let remainingSegments = [];

    for (let i = segments.length; i >= 1; i--) {
      const candidateSlug = segments.slice(0, i).join("/").toLowerCase();
      const found = await env.DB.prepare("SELECT * FROM links WHERE slug = ?").bind(candidateSlug).first();
      if (found) {
        link = found;
        matchedSlug = candidateSlug;
        matchedSegments = i;
        remainingSegments = segments.slice(i);
        break;
      }
    }

    if (!link) return new Response("Enlace no encontrado", { status: 404 });

    if (link.expires_at && Date.now() > Number(link.expires_at)) {
      return new Response("Este enlace ha expirado.", { status: 410 });
    }

    if (link.password) {
      let userPass = "";
      if (request.method === "POST") {
        const formData = await request.formData();
        userPass = formData.get("password") || "";
      } else {
        userPass = url.searchParams.get("pwd") || "";
      }
      if (userPass !== link.password) {
        const htmlRes = await fetch(new URL("/gs/password.html", url.origin));
        let html = await htmlRes.text();
        html = html.replace(/{{slug}}/g, matchedSlug);
        html = html.replace(/{{hasError}}/g, userPass ? '<div class="err">Contraseña incorrecta</div>' : '');
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    }

    recordAnalytics(context, env, matchedSlug, request);

    // Si es hub, renderizar hub.html (ignora remainingSegments)
    if (link.type === "group") {
      const hub = await env.DB.prepare("SELECT * FROM hub_configs WHERE slug = ?").bind(matchedSlug).first();
      const htmlRes = await fetch(new URL("/gs/hub.html", url.origin));
      let html = await htmlRes.text();
      let items = [];
      try { items = JSON.parse(hub?.items_json || "[]"); } catch {}
      const palettes = {
        emerald: { bg: "#090d0b", card: "#131c17", border: "#1f2e26", text: "#f9fafb", btn: "#10b981", btnText: "#062419" },
        midnight: { bg: "#0b0f19", card: "#111827", border: "#1f2937", text: "#f3f4f6", btn: "#3b82f6", btnText: "#ffffff" },
        cyberpunk: { bg: "#18052e", card: "#2b094f", border: "#491088", text: "#fdf4ff", btn: "#f43f5e", btnText: "#ffffff" },
        minimal_light: { bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", btn: "#0f172a", btnText: "#ffffff" }
      };
      const pal = palettes[hub?.theme_palette] || palettes.emerald;
      const bgStyle = hub?.bg_type === "custom" && hub?.bg_val ? hub.bg_val : pal.bg;
      let btnRadius = "10px";
      if (hub?.btn_style === "pill") btnRadius = "999px";
      if (hub?.btn_style === "sharp") btnRadius = "2px";
      const linksHtml = items.map(it => {
        const href = it.is_gs ? `${url.origin}/${it.url}` : it.url;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="hub-btn"><span>${it.title}</span><span>&rarr;</span></a>`;
      }).join("");
      html = html.replace(/{{slug}}/g, matchedSlug);
      html = html.replace(/{{title}}/g, hub?.title || matchedSlug);
      html = html.replace(/{{bgStyle}}/g, bgStyle);
      html = html.replace(/{{textColor}}/g, pal.text);
      html = html.replace(/{{btnColor}}/g, pal.btn);
      html = html.replace(/{{btnTextColor}}/g, pal.btnText);
      html = html.replace(/{{cardBg}}/g, pal.card);
      html = html.replace(/{{borderColor}}/g, pal.border);
      html = html.replace(/{{btnRadius}}/g, btnRadius);
      html = html.replace(/{{linksHtml}}/g, linksHtml);
      html = html.replace(/{{lang}}/g, hub?.lang_mode !== 'auto' ? hub?.lang_mode : 'es');
      html = html.replace(/{{bioHtml}}/g, hub?.bio ? `<p class="bio">${hub.bio}</p>` : '');
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Enlace directo: construir destino
    let target = link.target_url.replace(/\/+$/, "");

    // Si tiene splat, concatenar el resto de segmentos
    if (link.splat && remainingSegments.length > 0) {
      target += "/" + remainingSegments.join("/");
    }

    if (url.search) {
      const cleanParams = new URLSearchParams(url.search);
      cleanParams.delete("pwd");
      const qs = cleanParams.toString();
      if (qs) target += (target.includes("?") ? "&" : "?") + qs;
    }

    return Response.redirect(target, 302);

  } catch (error) {
    console.error('Error en Worker:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error', message: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
