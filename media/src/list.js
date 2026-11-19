// List writes for RSVP, bring, and donations. The Telegraph token is read from
// env.TELEGRAPH_TOKEN at request time and is never logged or returned.
// Edit and remove stay open to guests, matching the page: there is no
// owner-only list operation today.

export const BODY_LIMIT = 4096;
export const WRITE_LIMIT = 30;
export const WRITE_WINDOW_MS = 60 * 1000;

const GAMES = {
  alabama: {
    path: "G10T-tailgate-data-10-15",
    title: "G10T tailgate data",
    seedAttendees: true,
    items: ["cheese-slices", "red-bull", "orange-vodka", "vodka", "champagne", "dolly-shots", "beer", "high-noons", "nutrl", "hard-mountain-dew", "diet-soda", "regular-soda", "water", "pineapple-juice", "cranberry-juice"],
  },
  kentucky: {
    path: "G10T-tailgate-Kentucky-10-26",
    title: "G10T tailgate Kentucky",
    seedAttendees: false,
    items: ["red-bull", "orange-vodka", "vodka", "champagne", "dolly-shots", "beer", "high-noons", "nutrl", "hard-mountain-dew", "diet-soda", "regular-soda", "water", "pineapple-juice", "cranberry-juice", "chick-fil-a-biscuits"],
  },
  lsu: {
    path: "G10T-tailgate-LSU-11-08",
    title: "G10T tailgate LSU",
    seedAttendees: false,
    items: ["cheese-slices", "red-bull", "orange-vodka", "vodka", "champagne", "dolly-shots", "hard-mountain-dew", "diet-soda", "regular-soda", "water", "pineapple-juice", "cranberry-juice", "mustard-bottles", "golf-balls", "funny-kiffin-sign"],
  },
};

const LIMITS = { signups: 300, customItems: 80, donations: 300, attendees: 300 };
const OPS = {
  rsvp: {
    add: ["op", "name", "guests", "note"],
    update: ["op", "id", "name", "guests", "note"],
    delete: ["op", "id"],
  },
  bring: {
    add: ["op", "itemId", "name", "qty", "note"],
    update: ["op", "id", "name", "qty", "note"],
    delete: ["op", "id"],
    "add-item": ["op", "name", "unit", "category", "signerName", "qty", "note"],
    "rename-item": ["op", "id", "name", "unit"],
    "delete-item": ["op", "id"],
  },
  donations: {
    add: ["op", "name", "amount", "note"],
    update: ["op", "id", "name", "amount", "note"],
    delete: ["op", "id"],
  },
};

const hits = new Map();

export function resetWriteWindow() {
  hits.clear();
}

export function listGame(id) {
  return GAMES[id] || null;
}

function allowWrite(ip, now) {
  const key = ip || "unknown";
  const fresh = (hits.get(key) || []).filter((stamp) => now - stamp < WRITE_WINDOW_MS);
  if (fresh.length >= WRITE_LIMIT) {
    hits.set(key, fresh);
    return false;
  }
  fresh.push(now);
  hits.set(key, fresh);
  if (hits.size > 500) hits.delete(hits.keys().next().value);
  return true;
}

function clean(value, max, allowEmpty) {
  if (allowEmpty && (value == null || value === "")) return "";
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > max) return null;
  if (!text && !allowEmpty) return null;
  return text;
}

function whole(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}

function money(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return rounded < 0.01 || rounded > 5000 ? null : rounded;
}

function entryId(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,80}$/.test(value) ? value : null;
}

function exactKeys(body, keys) {
  const present = Object.keys(body);
  if (present.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(body, key));
}

function stamp() {
  return new Date().toISOString();
}

function seeds() {
  const start = Date.parse("2026-10-15T12:00:00.000Z");
  return ["Amy", "Mike", "Katie", "Morgan", "Jackson", "Braden", "Tessa"].map((name, index) => {
    const when = new Date(start + index * 1000).toISOString();
    return { id: "seed-" + name.toLowerCase(), name, guests: 1, note: "", createdAt: when, updatedAt: when };
  });
}

function keepSignup(row) {
  return !!row && typeof row === "object" && typeof row.id === "string" && typeof row.itemId === "string" && typeof row.name === "string" && typeof row.qty === "number" && typeof row.note === "string";
}

function keepItem(row) {
  if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.unit !== "string") return null;
  const category = row.category === "food" || row.category === "drink" ? row.category : "drink";
  return { ...row, category };
}

function keepDonation(row) {
  if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.amount !== "number" || typeof row.note !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    note: row.note,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

function keepAttendee(row) {
  return !!row && typeof row === "object" && typeof row.id === "string" && typeof row.name === "string" && typeof row.note === "string" && typeof row.guests === "number" && Number.isInteger(row.guests) && row.guests >= 1;
}

export function normalizeBoard(raw, game) {
  const source = raw && typeof raw === "object" ? raw : {};
  const attendees = Array.isArray(source.attendees)
    ? source.attendees.filter(keepAttendee)
    : game.seedAttendees
      ? seeds()
      : [];
  return {
    revision: typeof source.revision === "number" && source.revision >= 0 ? source.revision : 0,
    signups: Array.isArray(source.signups) ? source.signups.filter(keepSignup) : [],
    customItems: Array.isArray(source.customItems) ? source.customItems.map(keepItem).filter(Boolean) : [],
    donations: Array.isArray(source.donations) ? source.donations.map(keepDonation).filter(Boolean) : [],
    attendees,
  };
}

function knownItem(board, game, itemId) {
  return game.items.includes(itemId) || board.customItems.some((item) => item.id === itemId);
}

function nameOf(value, label) {
  const name = clean(value, 40, false);
  return name ? { name } : { error: `Enter ${label}. Keep it under 40 characters.` };
}

function noteOf(value) {
  const note = clean(value, 160, true);
  return note == null ? { error: "Keep the note under 160 characters, or leave it blank." } : { note };
}

function qtyOf(value) {
  const qty = whole(value);
  return qty == null ? { error: "Enter how many you're bringing. Use a whole number from 1 to 999." } : { qty };
}

function guestsOf(value) {
  const guests = whole(value);
  return guests == null ? { error: "Enter the number of guests. Use a whole number from 1 to 999." } : { guests };
}

export function applyList(board, game, route, body) {
  const ops = OPS[route];
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.op !== "string" || !ops[body.op]) {
    return { ok: false, error: "That action is not supported." };
  }
  if (!exactKeys(body, ops[body.op])) return { ok: false, error: "That action is not supported." };
  const next = {
    revision: board.revision,
    signups: board.signups.slice(),
    customItems: board.customItems.slice(),
    donations: board.donations.slice(),
    attendees: board.attendees.slice(),
  };
  const added = [];
  const when = stamp();

  if (route === "rsvp" && body.op === "add") {
    if (next.attendees.length >= LIMITS.attendees) return { ok: false, error: "The coming list is full. Text Amy and she'll make room." };
    const name = nameOf(body.name, "your name");
    if (name.error) return { ok: false, error: name.error };
    const guests = guestsOf(body.guests);
    if (guests.error) return { ok: false, error: guests.error };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    const id = crypto.randomUUID();
    next.attendees.push({ id, name: name.name, guests: guests.guests, note: note.note, createdAt: when, updatedAt: when });
    added.push(id);
  } else if (route === "rsvp" && body.op === "update") {
    const id = entryId(body.id);
    if (!id || !next.attendees.some((row) => row.id === id)) return { ok: false, error: "That name is no longer on the list." };
    const name = nameOf(body.name, "your name");
    if (name.error) return { ok: false, error: name.error };
    const guests = guestsOf(body.guests);
    if (guests.error) return { ok: false, error: guests.error };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    next.attendees = next.attendees.map((row) => row.id === id ? { ...row, name: name.name, guests: guests.guests, note: note.note, updatedAt: when } : row);
  } else if (route === "rsvp" && body.op === "delete") {
    const id = entryId(body.id);
    if (!id || !next.attendees.some((row) => row.id === id)) return { ok: false, error: "That name is no longer on the list." };
    next.attendees = next.attendees.filter((row) => row.id !== id);
  } else if (route === "bring" && body.op === "add") {
    const itemId = entryId(body.itemId);
    if (!itemId || !knownItem(next, game, itemId)) return { ok: false, error: "That item is not on the list anymore. Refresh and try again." };
    if (next.signups.length >= LIMITS.signups) return { ok: false, error: "The signup list is full. Text Amy and she'll make room." };
    const name = nameOf(body.name, "your name");
    if (name.error) return { ok: false, error: name.error };
    const qty = qtyOf(body.qty);
    if (qty.error) return { ok: false, error: qty.error };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    const id = crypto.randomUUID();
    next.signups.push({ id, itemId, name: name.name, qty: qty.qty, note: note.note, createdAt: when, updatedAt: when });
    added.push(id);
  } else if (route === "bring" && body.op === "update") {
    const id = entryId(body.id);
    if (!id || !next.signups.some((row) => row.id === id)) return { ok: false, error: "That signup is no longer on the list." };
    const name = nameOf(body.name, "your name");
    if (name.error) return { ok: false, error: name.error };
    const qty = qtyOf(body.qty);
    if (qty.error) return { ok: false, error: qty.error };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    next.signups = next.signups.map((row) => row.id === id ? { ...row, name: name.name, qty: qty.qty, note: note.note, updatedAt: when } : row);
  } else if (route === "bring" && body.op === "delete") {
    const id = entryId(body.id);
    if (!id || !next.signups.some((row) => row.id === id)) return { ok: false, error: "That signup is no longer on the list." };
    next.signups = next.signups.filter((row) => row.id !== id);
  } else if (route === "bring" && body.op === "add-item") {
    if (next.customItems.length >= LIMITS.customItems) return { ok: false, error: "The extra-item list is full. Text Amy and she'll make room." };
    const itemName = clean(body.name, 60, false);
    if (!itemName) return { ok: false, error: "Enter what you're bringing. Keep it under 60 characters." };
    const unit = clean(body.unit, 30, false);
    if (!unit) return { ok: false, error: "Enter a unit, like bags, bottles, or packs." };
    const signer = nameOf(body.signerName, "your name");
    if (signer.error) return { ok: false, error: signer.error };
    const qty = qtyOf(body.qty);
    if (qty.error) return { ok: false, error: qty.error };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    if (body.category !== "food" && body.category !== "drink") return { ok: false, error: "Pick food or drinks." };
    const itemId = crypto.randomUUID();
    const id = crypto.randomUUID();
    next.customItems.push({ id: itemId, name: itemName, unit, category: body.category, createdAt: when });
    next.signups.push({ id, itemId, name: signer.name, qty: qty.qty, note: note.note, createdAt: when, updatedAt: when });
    added.push(id);
  } else if (route === "bring" && body.op === "rename-item") {
    const id = entryId(body.id);
    if (!id || !next.customItems.some((row) => row.id === id)) return { ok: false, error: "That item is no longer on the list." };
    const itemName = clean(body.name, 60, false);
    if (!itemName) return { ok: false, error: "Enter what the item is called." };
    const unit = clean(body.unit, 30, false);
    if (!unit) return { ok: false, error: "Enter a unit, like bags, bottles, or packs." };
    next.customItems = next.customItems.map((row) => row.id === id ? { ...row, name: itemName, unit } : row);
  } else if (route === "bring" && body.op === "delete-item") {
    const id = entryId(body.id);
    if (!id || !next.customItems.some((row) => row.id === id)) return { ok: false, error: "That item is no longer on the list." };
    next.customItems = next.customItems.filter((row) => row.id !== id);
    next.signups = next.signups.filter((row) => row.itemId !== id);
  } else if (route === "donations" && body.op === "add") {
    if (next.donations.length >= LIMITS.donations) return { ok: false, error: "The donation list is full. Text Amy and she'll make room." };
    const name = nameOf(body.name, "your name");
    if (name.error) return { ok: false, error: name.error };
    const amount = money(body.amount);
    if (amount == null) return { ok: false, error: "Enter a dollar amount from $0.01 to $5,000." };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    const id = crypto.randomUUID();
    next.donations.push({ id, name: name.name, amount, note: note.note, createdAt: when, updatedAt: when });
    added.push(id);
  } else if (route === "donations" && body.op === "update") {
    const id = entryId(body.id);
    if (!id || !next.donations.some((row) => row.id === id)) return { ok: false, error: "That donation is no longer on the list." };
    const name = nameOf(body.name, "your name");
    if (name.error) return { ok: false, error: name.error };
    const amount = money(body.amount);
    if (amount == null) return { ok: false, error: "Enter a dollar amount from $0.01 to $5,000." };
    const note = noteOf(body.note);
    if (note.error) return { ok: false, error: note.error };
    next.donations = next.donations.map((row) => row.id === id ? { ...row, name: name.name, amount, note: note.note, updatedAt: when } : row);
  } else if (route === "donations" && body.op === "delete") {
    const id = entryId(body.id);
    if (!id || !next.donations.some((row) => row.id === id)) return { ok: false, error: "That donation is no longer on the list." };
    next.donations = next.donations.filter((row) => row.id !== id);
  } else {
    return { ok: false, error: "That action is not supported." };
  }
  return { ok: true, board: next, added };
}

function pageText(payload) {
  const node = payload && payload.result && payload.result.content && payload.result.content[0];
  const child = node && node.children && node.children[0];
  return typeof child === "string" ? child : "";
}

async function readBoard(game) {
  const response = await fetch("https://api.telegra.ph/getPage/" + game.path + "?return_content=true");
  if (!response.ok) return { error: "Couldn't reach the signup list. Check your signal and try again." };
  const payload = await response.json();
  if (!payload || !payload.ok) return { error: "Couldn't reach the signup list. Check your signal and try again." };
  const text = pageText(payload);
  if (!text) return { error: "Couldn't reach the signup list. Check your signal and try again." };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "Couldn't reach the signup list. Check your signal and try again." };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.signups)) {
    return { error: "Couldn't reach the signup list. Check your signal and try again." };
  }
  return { board: normalizeBoard(parsed, game) };
}

async function writeBoard(game, board, token) {
  const body = new URLSearchParams();
  body.set("access_token", token);
  body.set("title", game.title);
  body.set("content", JSON.stringify([{ tag: "pre", children: [JSON.stringify(board)] }]));
  body.set("return_content", "true");
  const response = await fetch("https://api.telegra.ph/editPage/" + game.path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!response.ok) return false;
  const payload = await response.json();
  return Boolean(payload && payload.ok);
}

async function readBody(request) {
  if (!request.body) return { error: "That action is not supported.", status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    received += step.value.byteLength;
    if (received > BODY_LIMIT) return { error: "That save is too large.", status: 413 };
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return { error: "That action is not supported.", status: 400 };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "That action is not supported.", status: 400 };
    return { body: parsed };
  } catch {
    return { error: "That action is not supported.", status: 400 };
  }
}

export async function handleListWrite(request, env, gameId, route, origin, json) {
  const game = listGame(gameId);
  if (!game || !OPS[route]) return json({ error: "Unknown game." }, 404, origin);
  if (request.method !== "POST") return json({ error: "That action is not supported." }, 405, origin);
  const loaded = await readBody(request);
  if (loaded.error) return json({ error: loaded.error }, loaded.status, origin);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!allowWrite(ip, Date.now())) return json({ error: "Too many saves. Wait a minute and try again." }, 429, origin);
  const token = env.TELEGRAPH_TOKEN || "";
  if (!token) return json({ error: "The list can't be saved right now." }, 503, origin);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readBoard(game);
    if (current.error) return json({ error: current.error }, 502, origin);
    const applied = applyList(current.board, game, route, loaded.body);
    if (!applied.ok) return json({ error: applied.error }, 400, origin);
    const saved = { ...applied.board, revision: current.board.revision + 1 };
    const wrote = await writeBoard(game, saved, token);
    if (wrote) return json({ ok: true, board: saved, added: applied.added }, 200, origin);
  }
  return json({ error: "Could not save. Try again." }, 502, origin);
}
