const GAMES = new Set(["lsu", "kentucky"]);
const PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const EXT_TYPE = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin, { "content-type": "application/json; charset=utf-8" }),
  });
}

function corsHeaders(origin, extra) {
  const headers = new Headers(extra || {});
  if (allowedOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-headers", "content-type, x-guest-pin, x-owner-token, x-file-name, x-guest-name");
    headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  }
  return headers;
}

function allowedOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || "") || origin === "https://amy-gleason.github.io";
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function plain(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) return null;
  return text;
}

function num(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function pinFor(env, game) {
  if (game === "lsu") return env.GUEST_PIN_LSU || "";
  if (game === "kentucky") return env.GUEST_PIN_KENTUCKY || "";
  return "";
}

function authorizedGuest(request, env, game) {
  const expected = pinFor(env, game);
  if (!expected) return "unconfigured";
  return safeEqual(request.headers.get("x-guest-pin") || "", expected) ? "ok" : "denied";
}

function authorizedOwner(request, env) {
  const expected = env.OWNER_TOKEN || "";
  if (!expected) return "unconfigured";
  return safeEqual(request.headers.get("x-owner-token") || "", expected) ? "ok" : "denied";
}

function extensionOf(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : "";
}

function previewKind(type) {
  if (type === "image/jpeg" || type === "image/png" || type === "image/gif" || type === "image/webp") return "image";
  if (type === "video/mp4" || type === "video/webm") return "video";
  return "none";
}

function fileName(value) {
  const base = String(value || "upload").split(/[\\/]/).pop().replace(/[^\w.\- ()]+/g, "").trim();
  return base.slice(0, 120) || "upload";
}

async function listAll(env, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
    if (objects.length > 5000) break;
  } while (cursor);
  return objects;
}

async function mutateJson(env, key, create, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await env.MEDIA.get(key);
    const body = current ? change(await current.json()) : create();
    if (!body) return null;
    const onlyIf = current ? { etagMatches: current.etag } : { etagDoesNotMatch: "missing" };
    const stored = await env.MEDIA.put(key, JSON.stringify(body), {
      httpMetadata: { contentType: "application/json" },
      onlyIf,
    });
    if (stored) return body;
  }
  return null;
}

async function rateAllow(env, game, kind, limit) {
  const key = `meta/${game}/rate.json`;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const next = await mutateJson(
    env,
    key,
    () => ({ uploads: [], posts: [], [kind]: [now], blocked: false }),
    (data) => {
      const bucket = Array.isArray(data[kind]) ? data[kind].filter((time) => now - time < windowMs) : [];
      if (bucket.length >= limit) return { ...data, [kind]: bucket, blocked: true };
      return { ...data, [kind]: bucket.concat(now), blocked: false };
    },
  );
  return Boolean(next && next.blocked === false);
}

function metaValue(meta, key) {
  if (!meta) return "";
  if (meta[key]) return meta[key];
  const found = Object.keys(meta).find((name) => name.toLowerCase() === key.toLowerCase());
  return found ? meta[found] : "";
}

function fileRecord(object) {
  const meta = object.customMetadata || {};
  const type = metaValue(meta, "contentType") || object.httpMetadata?.contentType || "application/octet-stream";
  return {
    id: object.key.split("/").pop(),
    name: metaValue(meta, "name") || "upload",
    contentType: type,
    bytes: Number(metaValue(meta, "bytes") || object.size || 0),
    createdAt: metaValue(meta, "createdAt"),
    uploadedBy: metaValue(meta, "uploadedBy"),
    preview: previewKind(type),
  };
}

async function handleFiles(request, env, game, origin, id) {
  if (request.method === "GET" && !id) {
    const objects = await listAll(env, `files/${game}/`);
    const files = [];
    for (const object of objects) {
      if (object.key.endsWith("/")) continue;
      const full = await env.MEDIA.head(object.key);
      files.push(fileRecord(full || object));
    }
    files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ files }, 200, origin);
  }
  if (request.method === "GET" && id) {
    const object = await env.MEDIA.get(`files/${game}/${id}`);
    if (!object) return json({ error: "That file is gone." }, 404, origin);
    const type = object.customMetadata?.contentType || "application/octet-stream";
    const inline = new URL(request.url).searchParams.get("inline") === "1" && previewKind(type) !== "none";
    const name = object.customMetadata?.name || "download";
    const headers = corsHeaders(origin, {
      "content-type": type,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=60",
    });
    return new Response(object.body, { headers });
  }
  if (request.method === "POST" && !id) {
    if (env.UPLOADS_ENABLED !== "true") return json({ error: "Uploads are turned off." }, 403, origin);
    const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const name = fileName(request.headers.get("x-file-name"));
    const ext = extensionOf(name);
    const guest = plain(request.headers.get("x-guest-name") || "", 40);
    if (!guest) return json({ error: "Enter your name." }, 400, origin);
    if (!EXT_TYPE[ext] || EXT_TYPE[ext] !== type) return json({ error: "That file type is not allowed." }, 415, origin);
    const bytes = Number(request.headers.get("content-length"));
    const max = PHOTO_TYPES.has(type) ? num(env, "MAX_PHOTO_BYTES", 20971520) : num(env, "MAX_VIDEO_BYTES", 83886080);
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > max) return json({ error: "That file is empty or too large." }, 413, origin);
    if (!(await rateAllow(env, game, "uploads", 8))) return json({ error: "Too many uploads. Wait a few minutes." }, 429, origin);
    const existing = await listAll(env, `files/${game}/`);
    const used = existing.reduce((sum, object) => sum + Number(object.customMetadata?.bytes || object.size || 0), 0);
    if (existing.length >= num(env, "MAX_GAME_FILES", 200) || used + bytes > num(env, "MAX_GAME_BYTES", 2147483648)) {
      return json({ error: "This game's storage is full." }, 413, origin);
    }
    const fileId = crypto.randomUUID();
    await env.MEDIA.put(`files/${game}/${fileId}`, request.body, {
      httpMetadata: { contentType: type },
      customMetadata: {
        name,
        contentType: type,
        bytes: String(bytes),
        uploadedBy: guest,
        createdAt: new Date().toISOString(),
      },
    });
    return json({ id: fileId, preview: previewKind(type) }, 201, origin);
  }
  if (request.method === "DELETE" && id) {
    const owner = authorizedOwner(request, env);
    if (owner !== "ok") return json({ error: owner === "unconfigured" ? "Removal is not configured." : "Owner key was not accepted." }, owner === "unconfigured" ? 503 : 401, origin);
    await env.MEDIA.delete(`files/${game}/${id}`);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: "That action is not supported." }, 405, origin);
}

async function handlePosts(request, env, game, origin, id, replyId) {
  if (request.method === "GET" && !id) {
    const objects = await listAll(env, `posts/${game}/`);
    const posts = [];
    for (const object of objects) {
      const body = await env.MEDIA.get(object.key);
      if (body) posts.push(await body.json());
    }
    posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ posts }, 200, origin);
  }
  if (request.method === "POST" && !id) {
    if (env.POSTS_ENABLED !== "true") return json({ error: "Posts are turned off." }, 403, origin);
    const payload = await request.json().catch(() => null);
    const name = plain(payload?.name, 40);
    const text = plain(payload?.text, 1000);
    if (!name || !text) return json({ error: "Enter your name and a note." }, 400, origin);
    if (!(await rateAllow(env, game, "posts", 12))) return json({ error: "Too many posts. Wait a few minutes." }, 429, origin);
    const existing = await listAll(env, `posts/${game}/`);
    if (existing.length >= num(env, "MAX_POSTS", 500)) return json({ error: "The board is full." }, 413, origin);
    const post = { id: crypto.randomUUID(), name, text, createdAt: new Date().toISOString(), replies: [] };
    const stored = await mutateJson(env, `posts/${game}/${post.id}.json`, () => post, () => post);
    if (!stored) return json({ error: "Could not save that post. Try again." }, 409, origin);
    return json({ post: stored }, 201, origin);
  }
  if (request.method === "POST" && id && !replyId) {
    if (env.POSTS_ENABLED !== "true") return json({ error: "Posts are turned off." }, 403, origin);
    const payload = await request.json().catch(() => null);
    const name = plain(payload?.name, 40);
    const text = plain(payload?.text, 1000);
    if (!name || !text) return json({ error: "Enter your name and a reply." }, 400, origin);
    if (!(await rateAllow(env, game, "posts", 12))) return json({ error: "Too many posts. Wait a few minutes." }, 429, origin);
    const key = `posts/${game}/${id}.json`;
    const stored = await mutateJson(
      env,
      key,
      () => null,
      (post) => {
        if (!post) return null;
        const replies = Array.isArray(post.replies) ? post.replies : [];
        if (replies.length >= num(env, "MAX_REPLIES", 40)) return { ...post, blocked: true };
        return {
          ...post,
          blocked: false,
          replies: replies.concat({ id: crypto.randomUUID(), name, text, createdAt: new Date().toISOString() }),
        };
      },
    );
    if (!stored) return json({ error: "That post is gone." }, 404, origin);
    if (stored.blocked) return json({ error: "That post has too many replies." }, 413, origin);
    return json({ post: stored }, 201, origin);
  }
  if (request.method === "DELETE" && id) {
    const owner = authorizedOwner(request, env);
    if (owner !== "ok") return json({ error: owner === "unconfigured" ? "Removal is not configured." : "Owner key was not accepted." }, owner === "unconfigured" ? 503 : 401, origin);
    if (replyId) {
      const stored = await mutateJson(
        env,
        `posts/${game}/${id}.json`,
        () => null,
        (post) => (post ? { ...post, replies: (post.replies || []).filter((reply) => reply.id !== replyId) } : null),
      );
      if (!stored) return json({ error: "That post is gone." }, 404, origin);
      return json({ post: stored }, 200, origin);
    }
    await env.MEDIA.delete(`posts/${game}/${id}.json`);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: "That action is not supported." }, 405, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1" || !GAMES.has(parts[1])) return json({ error: "Unknown game." }, 404, origin);
    const game = parts[1];
    const guest = authorizedGuest(request, env, game);
    if (guest === "unconfigured") return json({ error: "Sharing is not configured." }, 503, origin);
    if (guest !== "ok") return json({ error: "Guest code was not accepted." }, 401, origin);
    try {
      if (parts[2] === "files") return await handleFiles(request, env, game, origin, parts[3]);
      if (parts[2] === "posts") return await handlePosts(request, env, game, origin, parts[3], parts[5]);
      return json({ error: "Unknown game." }, 404, origin);
    } catch {
      return json({ error: "Could not finish that. Try again." }, 500, origin);
    }
  },
};
