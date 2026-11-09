const JOURNAL = "meta/lsu/move-to-kentucky.json";
const LOCK_MS = 120000;
const MAX_FILES = 200;
const MAX_BYTES = 2147483648;
const MAX_POSTS = 500;
let testNow = 0;

export function noteTestNow(env, request) {
  if (env.TEST_CLOCK !== "1") return;
  const value = Number(request.headers.get("x-test-now") || 0);
  if (value > 0) testNow = value;
}

export function nowMs(env) {
  if (env.TEST_CLOCK === "1" && testNow) return testNow;
  return Date.now();
}

export function lockFresh(journal, now) {
  if (!journal || journal.phase === "done" || journal.phase === "blocked") return false;
  return now < Number(journal.lockExpiresAt || 0);
}

export function migrationKey(key) {
  return /^(?:files|posts)\/(?:lsu|kentucky)\//.test(key || "")
    || /^meta\/(?:lsu|kentucky)\/(?:quota|batches|rate)\.json$/.test(key || "");
}

function cap(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function etagOf(object) {
  return String((object && (object.etag || object.httpEtag)) || "").replace(/"/g, "");
}

function customOf(object) {
  const out = {};
  const raw = (object && object.customMetadata) || {};
  Object.keys(raw).forEach((key) => { out[key] = String(raw[key]); });
  return out;
}

function md5Of(object) {
  const value = object && object.checksums && object.checksums.md5;
  if (typeof value === "string") return value.toLowerCase();
  if (value instanceof ArrayBuffer) return hexBytes(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) return hexBytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return "";
}

function hexBytes(bytes) {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function sameChecksum(source, dest) {
  const left = md5Of(source);
  const right = md5Of(dest);
  if (left && right && left !== right) return false;
  return etagOf(source) === etagOf(dest);
}

function sameCustom(left, right) {
  const a = {};
  const b = {};
  Object.keys(left || {}).forEach((key) => { a[key.toLowerCase()] = String(left[key]); });
  Object.keys(right || {}).forEach((key) => { b[key.toLowerCase()] = String(right[key]); });
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function contentTypeOf(object) {
  return (object && object.httpMetadata && object.httpMetadata.contentType) || "";
}

async function readJournal(env) {
  const current = await env.MEDIA.get(JOURNAL);
  if (!current) return { journal: null, etag: "" };
  return { journal: await current.json(), etag: etagOf(current) };
}

async function saveJournal(env, journal, etag) {
  const stored = await env.MEDIA.put(JOURNAL, JSON.stringify(journal), {
    httpMetadata: { contentType: "application/json" },
    onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
  });
  return Boolean(stored);
}

export async function moveBlocksWrites(env, game) {
  if (game !== "lsu" && game !== "kentucky") return false;
  const { journal } = await readJournal(env);
  return lockFresh(journal, nowMs(env));
}

function publicView(journal, live) {
  const items = (journal && journal.items) || [];
  const verified = items.filter((item) => item.verified).length;
  const deleted = items.filter((item) => item.sourceDeleted).length;
  return {
    from: "lsu",
    to: "kentucky",
    files: live ? live.files : items.filter((item) => item.kind === "file").length,
    bytes: live ? live.bytes : items.filter((item) => item.kind === "file").reduce((sum, item) => sum + item.size, 0),
    posts: live ? live.posts : items.filter((item) => item.kind === "post").length,
    replies: journal && Number.isInteger(journal.replies) ? journal.replies : (live ? live.replies : 0),
    phase: journal ? journal.phase : "ready",
    copied: verified,
    removed: deleted,
    total: items.length,
    note: "Originals are removed only after the copies are checked.",
    error: journal && journal.error ? journal.error : "",
  };
}

async function liveCounts(env) {
  const files = await listMeta(env, "files/lsu/");
  const posts = await listMeta(env, "posts/lsu/");
  let replies = 0;
  for (const item of posts) {
    const object = await env.MEDIA.get(item.key);
    if (!object) continue;
    const body = await object.json();
    replies += Array.isArray(body.replies) ? body.replies.length : 0;
  }
  return {
    files: files.length,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    posts: posts.length,
    replies,
  };
}

async function listMeta(env, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
    for (const object of page.objects) {
      if (!object.key.endsWith("/")) objects.push(object);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function sourceKey(item) {
  return item.kind === "post" ? `posts/lsu/${item.id}.json` : `files/lsu/${item.id}`;
}

function destKey(item) {
  return item.kind === "post" ? `posts/kentucky/${item.id}.json` : `files/kentucky/${item.id}`;
}

async function snapshot(env) {
  const files = await listMeta(env, "files/lsu/");
  const posts = await listMeta(env, "posts/lsu/");
  const items = [];
  for (const object of files.concat(posts)) {
    const head = await env.MEDIA.head(object.key);
    if (!head) continue;
    const id = object.key.split("/").pop().replace(/\.json$/, "");
    const kind = object.key.startsWith("posts/") ? "post" : "file";
    items.push({
      kind,
      id,
      size: head.size,
      sourceEtag: etagOf(head),
      verified: false,
      sourceDeleted: false,
      skipped: false,
    });
  }
  return items;
}

async function destinationsCollide(env, items) {
  for (const item of items) {
    const dest = await env.MEDIA.head(destKey(item));
    if (!dest) continue;
    if (etagOf(dest) !== item.sourceEtag || dest.size !== item.size) return true;
    item.verified = true;
    item.destEtag = etagOf(dest);
  }
  return false;
}

function planned(items) {
  const files = items.filter((item) => item.kind === "file" && !item.skipped);
  const posts = items.filter((item) => item.kind === "post" && !item.skipped);
  return {
    files: files.length,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    posts: posts.length,
  };
}

export function quotaAfter(current, delta) {
  return {
    files: Math.max(0, (Number(current.files) || 0) + delta.files),
    bytes: Math.max(0, (Number(current.bytes) || 0) + delta.bytes),
    posts: Math.max(0, (Number(current.posts) || 0) + delta.posts),
  };
}

function deltaOf(journal) {
  const files = journal.items.filter((item) => item.kind === "file" && item.verified && !item.skipped);
  const posts = journal.items.filter((item) => item.kind === "post" && item.verified && !item.skipped);
  return {
    files: files.length,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    posts: posts.length,
  };
}

async function quotaOnce(env, game, delta, moveId) {
  const key = `meta/${game}/quota.json`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await env.MEDIA.get(key);
    const data = current ? await current.json() : { files: 0, bytes: 0, posts: 0, appliedMoves: [] };
    const applied = Array.isArray(data.appliedMoves) ? data.appliedMoves : [];
    if (applied.includes(moveId)) return { ok: true };
    const next = {
      ...data,
      ...quotaAfter(data, delta),
      appliedMoves: applied.concat(moveId).slice(-20),
    };
    if (game === "kentucky" && (next.files > cap(env, "MAX_GAME_FILES", MAX_FILES) || next.bytes > cap(env, "MAX_GAME_BYTES", MAX_BYTES) || next.posts > cap(env, "MAX_POSTS", MAX_POSTS))) {
      return { ok: false, full: true };
    }
    const stored = await env.MEDIA.put(key, JSON.stringify(next), {
      httpMetadata: { contentType: "application/json" },
      onlyIf: current ? { etagMatches: etagOf(current) } : { etagDoesNotMatch: "*" },
    });
    if (stored) return { ok: true };
  }
  return { ok: false };
}

async function copyItem(env, item) {
  const source = await env.MEDIA.get(sourceKey(item));
  if (!source) return { skipped: true };
  if (etagOf(source) !== item.sourceEtag || source.size !== item.size) return { blocked: "changed" };
  const custom = customOf(source);
  const stored = await env.MEDIA.put(destKey(item), source.body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: contentTypeOf(source) },
    customMetadata: custom,
  });
  const dest = await env.MEDIA.head(destKey(item));
  const matches = dest && sameChecksum(source, dest) && etagOf(dest) === item.sourceEtag && dest.size === item.size && sameCustom(custom, customOf(dest)) && contentTypeOf(dest) === contentTypeOf(source);
  if (!matches) {
    if (stored) await undoCopy(env, item);
    return { blocked: stored ? "mismatch" : "collision" };
  }
  return { verified: true, destEtag: etagOf(dest) };
}

async function undoCopy(env, item) {
  const dest = await env.MEDIA.head(destKey(item));
  const source = await env.MEDIA.head(sourceKey(item));
  if (dest && source && etagOf(dest) === item.sourceEtag && etagOf(source) === item.sourceEtag) {
    await env.MEDIA.delete(destKey(item));
  }
}

export async function handleMove(request, env, origin, json) {
  if (request.method === "GET") {
    const { journal } = await readJournal(env);
    if (journal && journal.phase !== "done") return json(publicView(journal), 200, origin);
    return json(publicView(null, await liveCounts(env)), 200, origin);
  }
  if (request.method !== "POST") return json({ error: "That action is not supported." }, 405, origin);
  const payload = await request.json().catch(() => null);
  if (!payload || payload.confirm !== "MOVE TO KENTUCKY") {
    return json({ error: "Confirm the move before it starts." }, 400, origin);
  }
  const now = nowMs(env);
  if (payload.step === "continue") return continueMove(env, origin, request, now, json);
  return startMove(env, origin, request, now, json);
}

async function startMove(env, origin, request, now, json) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { journal, etag } = await readJournal(env);
    if (journal && journal.phase !== "done" && !(journal.phase === "blocked" && !journal.quotaApplied)) {
      const presented = request.headers.get("x-move-lock") || "";
      if (journal.phase !== "blocked" && lockFresh(journal, now) && presented !== journal.lockId) {
        return json({ error: "This move is still running on the phone that started it." }, 409, origin);
      }
      if (journal.phase === "blocked" && journal.quotaApplied) {
        journal.phase = "delete";
        journal.error = "";
      }
      if (!lockFresh(journal, now)) journal.lockId = crypto.randomUUID();
      journal.lockExpiresAt = now + LOCK_MS;
      if (!(await saveJournal(env, journal, etag))) continue;
      return json({ ...publicView(journal), lockId: journal.lockId }, 200, origin);
    }
    const items = await snapshot(env);
    if (await destinationsCollide(env, items)) {
      return json({ error: "Kentucky already has something with that id. Nothing was removed.", phase: "blocked" }, 409, origin);
    }
    const ky = await env.MEDIA.get("meta/kentucky/quota.json");
    const kyData = ky ? await ky.json() : { files: 0, bytes: 0, posts: 0 };
    const incoming = planned(items);
    const roomFiles = cap(env, "MAX_GAME_FILES", MAX_FILES);
    const roomBytes = cap(env, "MAX_GAME_BYTES", MAX_BYTES);
    const roomPosts = cap(env, "MAX_POSTS", MAX_POSTS);
    if ((Number(kyData.files) || 0) + incoming.files > roomFiles || (Number(kyData.bytes) || 0) + incoming.bytes > roomBytes || (Number(kyData.posts) || 0) + incoming.posts > roomPosts) {
      return json({ error: "Kentucky does not have room. Nothing was removed.", phase: "blocked" }, 409, origin);
    }
    let replies = 0;
    for (const item of items) {
      if (item.kind !== "post") continue;
      const object = await env.MEDIA.get(sourceKey(item));
      if (!object) continue;
      const body = await object.json().catch(() => null);
      replies += body && Array.isArray(body.replies) ? body.replies.length : 0;
    }
    const created = {
      moveId: crypto.randomUUID(),
      lockId: crypto.randomUUID(),
      lockExpiresAt: now + LOCK_MS,
      phase: "copy",
      items,
      replies,
      quotaApplied: false,
      error: "",
    };
    if (!(await saveJournal(env, created, etag))) continue;
    return json({ ...publicView(created), lockId: created.lockId }, 200, origin);
  }
  return json({ error: "Could not start the move. Nothing was removed." }, 409, origin);
}

async function continueMove(env, origin, request, now, json) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { journal, etag } = await readJournal(env);
    if (!journal || journal.phase === "done") return json(publicView(journal, journal ? null : await liveCounts(env)), 200, origin);
    if (journal.phase === "blocked") return json({ ...publicView(journal), error: journal.error }, 409, origin);
    const presented = request.headers.get("x-move-lock") || "";
    if (lockFresh(journal, now) && presented !== journal.lockId) {
      return json({ error: "This move is still running on the phone that started it." }, 409, origin);
    }
    if (!lockFresh(journal, now)) journal.lockId = crypto.randomUUID();
    journal.lockExpiresAt = now + LOCK_MS;
    const outcome = await step(env, journal);
    if (outcome === "retry") continue;
    if (!(await saveJournal(env, journal, etag))) continue;
    const body = { ...publicView(journal), lockId: journal.lockId };
    return json(body, journal.phase === "blocked" ? 409 : 200, origin);
  }
  return json({ error: "Could not continue the move. Nothing new was removed." }, 409, origin);
}

async function step(env, journal) {
  const pending = journal.items.find((item) => !item.verified && !item.skipped);
  if (pending) {
    const result = await copyItem(env, pending);
    if (result.skipped) pending.skipped = true;
    else if (result.blocked) {
      if (result.undo) await undoCopy(env, pending);
      journal.phase = "blocked";
      journal.error = result.blocked === "collision"
        ? "Kentucky already has something with that id. Nothing was removed."
        : "A copy did not match the original. Nothing was removed.";
      journal.lockExpiresAt = 0;
    } else {
      pending.verified = true;
      pending.destEtag = result.destEtag;
    }
    return "ok";
  }
  if (!journal.quotaApplied) {
    const delta = deltaOf(journal);
    const added = await quotaOnce(env, "kentucky", delta, journal.moveId);
    if (!added.ok) {
      journal.phase = "blocked";
      journal.error = "Kentucky does not have room. Nothing was removed.";
      journal.lockExpiresAt = 0;
      return "ok";
    }
    const removed = await quotaOnce(env, "lsu", { files: -delta.files, bytes: -delta.bytes, posts: -delta.posts }, journal.moveId);
    if (!removed.ok) return "retry";
    journal.quotaApplied = true;
    journal.phase = "delete";
    return "ok";
  }
  const doomed = journal.items.find((item) => item.verified && !item.sourceDeleted && !item.skipped);
  if (doomed) {
    const removed = await deleteSource(env, doomed);
    if (!removed.ok) {
      journal.phase = "blocked";
      journal.error = "Could not remove an original after the copy was checked.";
      journal.lockExpiresAt = 0;
      return "ok";
    }
    doomed.sourceDeleted = true;
    return "ok";
  }
  journal.phase = "done";
  journal.lockExpiresAt = 0;
  return "ok";
}

async function deleteSource(env, item) {
  const source = await env.MEDIA.head(sourceKey(item));
  const dest = await env.MEDIA.head(destKey(item));
  if (!dest || etagOf(dest) !== item.sourceEtag || dest.size !== item.size) return { ok: false };
  if (!source) return { ok: true };
  if (etagOf(source) !== item.sourceEtag || !sameChecksum(source, dest)) return { ok: false };
  await env.MEDIA.delete(sourceKey(item));
  const gone = await env.MEDIA.head(sourceKey(item));
  return { ok: !gone };
}
