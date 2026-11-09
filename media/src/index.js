const GAMES = new Set(["lsu", "kentucky", "alabama"]);
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
    headers.set("access-control-allow-headers", "content-type, x-guest-pin, x-owner-token, x-file-name, x-guest-name, x-batch-id, x-batch-size");
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

function messageText(value, max) {
  if (typeof value !== "string") return { text: "", tooLong: false };
  const text = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return { text, tooLong: text.length > max };
}

function num(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function pinFor(env, game) {
  if (game === "lsu") return env.GUEST_PIN_LSU || "";
  if (game === "kentucky") return env.GUEST_PIN_KENTUCKY || "";
  if (game === "alabama") return env.GUEST_PIN_ALABAMA || "";
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

function safeId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

async function reserveSlot(env, game, patch, accept) {
  const key = `meta/${game}/quota.json`;
  const blank = { files: 0, bytes: 0, posts: 0 };
  const next = await mutateJson(
    env,
    key,
    () => {
      const created = { ...blank, ...patch(blank) };
      return accept(created) ? { ...created, blocked: false } : { ...blank, blocked: true };
    },
    (data) => {
      const current = {
        files: Number(data.files) || 0,
        bytes: Number(data.bytes) || 0,
        posts: Number(data.posts) || 0,
      };
      const updated = { ...current, ...patch(current) };
      return accept(updated) ? { ...updated, blocked: false } : { ...current, blocked: true };
    },
  );
  return Boolean(next && next.blocked === false);
}

async function releaseSlot(env, game, files, bytes, posts) {
  await mutateJson(
    env,
    `meta/${game}/quota.json`,
    () => ({ files: 0, bytes: 0, posts: 0, blocked: false }),
    (data) => ({
      files: Math.max(0, (Number(data.files) || 0) - files),
      bytes: Math.max(0, (Number(data.bytes) || 0) - bytes),
      posts: Math.max(0, (Number(data.posts) || 0) - posts),
      blocked: false,
    }),
  );
}

function batchRequest(request) {
  const sizeHeader = request.headers.get("x-batch-size");
  const idHeader = request.headers.get("x-batch-id");
  if (sizeHeader == null && idHeader == null) return { legacy: true };
  const batchSize = Number(sizeHeader);
  const batchId = String(idHeader || "").toLowerCase();
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    return { error: "Choose 50 files or fewer at a time." };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(batchId)) {
    return { error: "Choose 50 files or fewer at a time." };
  }
  return { id: batchId, size: batchSize };
}

async function claimBatch(env, game, batch) {
  const next = await mutateJson(
    env,
    `meta/${game}/batches.json`,
    () => ({ order: [batch.id], counts: { [batch.id]: 1 }, blocked: false }),
    (data) => {
      const counts = { ...(data.counts || {}) };
      const order = Array.isArray(data.order) ? data.order.slice() : [];
      if (!Object.prototype.hasOwnProperty.call(counts, batch.id)) {
        counts[batch.id] = 0;
        order.push(batch.id);
      }
      if (counts[batch.id] >= batch.size || counts[batch.id] >= 50) {
        return { order, counts, blocked: true };
      }
      counts[batch.id] += 1;
      while (order.length > 40) delete counts[order.shift()];
      return { order, counts, blocked: false };
    },
  );
  return Boolean(next && next.blocked === false);
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
    if (!safeId(id)) return json({ error: "That file is gone." }, 404, origin);
    const object = await env.MEDIA.get(`files/${game}/${id}`);
    if (!object) return json({ error: "That file is gone." }, 404, origin);
    const type = metaValue(object.customMetadata, "contentType") || "application/octet-stream";
    const inline = new URL(request.url).searchParams.get("inline") === "1" && previewKind(type) !== "none";
    const name = metaValue(object.customMetadata, "name") || "download";
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
    const batch = batchRequest(request);
    if (batch.error) return json({ error: batch.error }, 400, origin);
    if (!batch.legacy && !(await claimBatch(env, game, batch))) {
      return json({ error: "That batch is already full. Retry only the files that did not upload." }, 400, origin);
    }
    const maxFiles = num(env, "MAX_GAME_FILES", 200);
    const maxBytes = num(env, "MAX_GAME_BYTES", 2147483648);
    const reserved = await reserveSlot(
      env,
      game,
      (current) => ({ files: current.files + 1, bytes: current.bytes + bytes }),
      (next) => next.files <= maxFiles && next.bytes <= maxBytes,
    );
    if (!reserved) return json({ error: "This game's storage is full." }, 413, origin);
    const fileId = crypto.randomUUID();
    const key = `files/${game}/${fileId}`;
    let stored = null;
    try {
      stored = await env.MEDIA.put(key, request.body, {
        httpMetadata: { contentType: type },
        customMetadata: {
          name,
          contentType: type,
          bytes: String(bytes),
          uploadedBy: guest,
          createdAt: new Date().toISOString(),
        },
      });
      const head = stored ? await env.MEDIA.head(key) : null;
      const actual = head ? head.size : 0;
      if (!head || actual < 1 || actual > max || actual > bytes) {
        if (head) await env.MEDIA.delete(key);
        await releaseSlot(env, game, 1, bytes, 0);
        return json({ error: "That file is empty or too large." }, 413, origin);
      }
      if (actual < bytes) await releaseSlot(env, game, 0, bytes - actual, 0);
    } catch (error) {
      await releaseSlot(env, game, 1, bytes, 0);
      throw error;
    }
    return json({ id: fileId, preview: previewKind(type) }, 201, origin);
  }
  if (request.method === "DELETE" && id) {
    if (!safeId(id)) return json({ error: "That file is gone." }, 404, origin);
    const owner = authorizedOwner(request, env);
    if (owner !== "ok") return json({ error: owner === "unconfigured" ? "Removal is not configured." : "Owner key was not accepted." }, owner === "unconfigured" ? 503 : 401, origin);
    const key = `files/${game}/${id}`;
    const head = await env.MEDIA.head(key);
    await env.MEDIA.delete(key);
    if (head) await releaseSlot(env, game, 1, head.size || 0, 0);
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
    if (env.POSTS_ENABLED !== "true") return json({ error: "Messages are turned off." }, 403, origin);
    const payload = await request.json().catch(() => null);
    const name = plain(payload?.name, 40);
    const body = messageText(payload?.text, 5000);
    if (!name || !body.text) return json({ error: "Enter your name and a message." }, 400, origin);
    if (body.tooLong) return json({ error: "That message is longer than 5000 characters." }, 400, origin);
    const text = body.text;
    if (!(await rateAllow(env, game, "posts", 12))) return json({ error: "Too many messages. Wait a few minutes." }, 429, origin);
    const maxPosts = num(env, "MAX_POSTS", 500);
    const reserved = await reserveSlot(
      env,
      game,
      (current) => ({ posts: current.posts + 1 }),
      (next) => next.posts <= maxPosts,
    );
    if (!reserved) return json({ error: "The board is full." }, 413, origin);
    const post = { id: crypto.randomUUID(), name, text, createdAt: new Date().toISOString(), replies: [] };
    let stored = null;
    try {
      stored = await mutateJson(env, `posts/${game}/${post.id}.json`, () => post, () => post);
    } catch (error) {
      await releaseSlot(env, game, 0, 0, 1);
      throw error;
    }
    if (!stored) {
      await releaseSlot(env, game, 0, 0, 1);
      return json({ error: "Could not save that message. Try again." }, 409, origin);
    }
    return json({ post: stored }, 201, origin);
  }
  if (request.method === "POST" && id && !replyId) {
    if (env.POSTS_ENABLED !== "true") return json({ error: "Messages are turned off." }, 403, origin);
    const payload = await request.json().catch(() => null);
    const name = plain(payload?.name, 40);
    const body = messageText(payload?.text, 1000);
    if (!name || !body.text) return json({ error: "Enter your name and a reply." }, 400, origin);
    if (body.tooLong) return json({ error: "That reply is longer than 1000 characters." }, 400, origin);
    const text = body.text;
    if (!(await rateAllow(env, game, "posts", 12))) return json({ error: "Too many messages. Wait a few minutes." }, 429, origin);
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
    if (!stored) return json({ error: "That message is gone." }, 404, origin);
    if (stored.blocked) return json({ error: "That message has too many replies." }, 413, origin);
    return json({ post: stored }, 201, origin);
  }
  if (request.method === "DELETE" && id) {
    if (!safeId(id) || (replyId && !safeId(replyId))) return json({ error: "That message is gone." }, 404, origin);
    const owner = authorizedOwner(request, env);
    if (owner !== "ok") return json({ error: owner === "unconfigured" ? "Removal is not configured." : "Owner key was not accepted." }, owner === "unconfigured" ? 503 : 401, origin);
    if (replyId) {
      const stored = await mutateJson(
        env,
        `posts/${game}/${id}.json`,
        () => null,
        (post) => (post ? { ...post, replies: (post.replies || []).filter((reply) => reply.id !== replyId) } : null),
      );
      if (!stored) return json({ error: "That message is gone." }, 404, origin);
      return json({ post: stored }, 200, origin);
    }
    await env.MEDIA.delete(`posts/${game}/${id}.json`);
    await releaseSlot(env, game, 0, 0, 1);
    return json({ ok: true }, 200, origin);
  }
  return json({ error: "That action is not supported." }, 405, origin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        uploads: env.UPLOADS_ENABLED === "true",
        posts: env.POSTS_ENABLED === "true",
        games: { lsu: Boolean(env.GUEST_PIN_LSU), kentucky: Boolean(env.GUEST_PIN_KENTUCKY), alabama: Boolean(env.GUEST_PIN_ALABAMA) },
        owner: Boolean(env.OWNER_TOKEN),
      }, 200, origin);
    }
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
