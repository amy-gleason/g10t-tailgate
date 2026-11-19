import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/pw/node_modules/puppeteer-core");
const axeSource = readFileSync("/tmp/pw/node_modules/axe-core/axe.min.js", "utf8");
const root = new URL("..", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webm": "video/webm" };

function serve() {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    const rel = path === "/" ? "preview/index.html" : path.replace(/^\/+/, "");
    const file = join(root, rel);
    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    readFile(file, (error, body) => {
      if (error) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      response.end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("font rules inherit a real family and inputs stay at least 16px", () => {
  const css = readFileSync(join(root, "tailgate.css"), "utf8");
  const bad = [];
  const re = /(^|[^\w-])font\s*:\s*([^;]+);/g;
  let match;
  while ((match = re.exec(css))) {
    const value = match[2].trim();
    if (value === "inherit" || value === "initial" || value === "unset" || value === "revert") continue;
    if (/\binherit\b/.test(value)) bad.push(value);
  }
  assert.deepEqual(bad, []);
  assert.match(css, /font-size:\s*max\(16px,\s*1\.125rem\)/);
  assert.match(css, /\.total-n\s*\{[^}]*#A04D00/);
  const client = readFileSync(join(root, "media-client.js"), "utf8");
  assert.match(client, /vols-tailgate-name/);
  assert.match(client, /Signed in as guest for /);
  assert.match(client, /Forget code on this device/);
  assert.match(client, /Signed in as owner/);
  assert.match(client, /id: "owner-sign-out"/);
  assert.match(client, /Photo" \+ who|kind \+ " from "/);
  assert.doesNotMatch(client, /localStorage\.setItem\(ownerKey/);
  assert.doesNotMatch(client, /localStorage\.setItem\(\s*["']tailgate-owner/);
  assert.doesNotMatch(client, /workers\.dev/);
  assert.doesNotMatch(client, /alt: ""/);
});

function channel(value) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function contrast(rgb, background) {
  function lum(color) {
    const parts = color.match(/\d+/g).map(Number);
    return 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
  }
  const lighter = Math.max(lum(rgb), lum(background));
  const darker = Math.min(lum(rgb), lum(background));
  return (lighter + 0.05) / (darker + 0.05);
}

async function axe(page, context) {
  await page.evaluate(axeSource);
  return page.evaluate(async (target) => {
    const result = await window.axe.run(target || document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations
      .filter((item) => item.impact === "serious" || item.impact === "critical")
      .map((item) => ({
        id: item.id,
        impact: item.impact,
        help: item.help,
        targets: item.nodes.slice(0, 4).map((node) => node.target.join(" ")),
      }));
  }, context);
}

async function setName(page, selector, value) {
  await page.evaluate((sel, next) => {
    const input = document.querySelector(sel);
    input.focus();
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector, value);
}

test("game-day polish keeps names, the sign-in chip, contrast, and alt text", { timeout: 120000 }, async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/preview/index.html";
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const leaks = [];
  try {
    const page = await browser.newPage();
    page.on("request", (request) => {
      if (request.url().includes("workers.dev")) leaks.push(request.url());
    });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#coming [data-guest-name]");
    await page.waitForSelector("#guest-chip-text");
    await page.waitForSelector("#photos-body [data-guest-name]");

    const photosClosed = await page.$eval("#acc-photos", (node) => node.classList.contains("open"));
    assert.equal(photosClosed, false);
    assert.equal(await page.$eval("#guest-chip-text", (node) => node.textContent), "Signed in as guest for LSU");
    assert.equal(await page.$eval("#guest-chip", (node) => node.hidden), false);
    const forgetBox = await page.$eval("#forget-code", (node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent, width: rect.width, height: rect.height };
    });
    assert.equal(forgetBox.text, "Forget code on this device");
    assert.ok(forgetBox.width >= 44 && forgetBox.height >= 44, JSON.stringify(forgetBox));

    const metrics = await page.evaluate(() => {
      const body = getComputedStyle(document.body).fontFamily;
      function read(selector) {
        const style = getComputedStyle(document.querySelector(selector));
        return { fontSize: Number.parseFloat(style.fontSize), family: style.fontFamily, weight: style.fontWeight };
      }
      return {
        body,
        input: read("#coming .input"),
        file: read(".file-input"),
        area: read("#posts-body textarea"),
        toggle: read(".acc-toggle"),
        button: read("#coming .btn"),
        total: getComputedStyle(document.querySelector(".total-n")).color,
      };
    });
    assert.ok(metrics.input.fontSize >= 16, JSON.stringify(metrics));
    assert.equal(metrics.input.family, metrics.body);
    assert.ok(metrics.file.fontSize >= 16, JSON.stringify(metrics));
    assert.ok(metrics.area.fontSize >= 16, JSON.stringify(metrics));
    assert.ok(metrics.toggle.fontSize >= 21, JSON.stringify(metrics));
    assert.equal(metrics.toggle.weight, "800");
    assert.equal(metrics.toggle.family, metrics.body);
    assert.ok(metrics.button.fontSize >= 18, JSON.stringify(metrics));
    assert.equal(metrics.button.weight, "600");
    assert.equal(metrics.total, "rgb(160, 77, 0)");
    assert.ok(contrast(metrics.total, "rgb(255, 255, 255)") >= 4.5);

    const comingAxe = await axe(page);
    assert.deepEqual(comingAxe, [], JSON.stringify(comingAxe));

    await page.click('[data-section="posts"] .acc-toggle');
    await page.waitForSelector("#posts-body .post label .label");
    assert.equal(await page.$eval("#posts-body .post label .label", (node) => node.textContent), "Your name");
    const postsAxe = await axe(page);
    assert.deepEqual(postsAxe, [], JSON.stringify(postsAxe));
    await setName(page, "#posts-body form [data-guest-name]", "");
    await page.click("#posts-body form button[type=submit]");
    assert.equal(await page.$eval("#message-name-error", (node) => node.textContent), "Name is required");

    await page.click('[data-section="coming"] .acc-toggle');
    await setName(page, "#coming [data-guest-name]", "Riley");
    const shared = await page.evaluate(() => ({
      photo: document.querySelector("#photos-body [data-guest-name]").value,
      message: document.querySelector("#posts-body form [data-guest-name]").value,
      reply: document.querySelector("#posts-body .post [data-guest-name]").value,
      stored: localStorage.getItem("vols-tailgate-name"),
    }));
    assert.equal(shared.photo, "Riley");
    assert.equal(shared.message, "Riley");
    assert.equal(shared.reply, "Riley");
    assert.equal(shared.stored, "Riley");

    await setName(page, "#photos-body [data-guest-name]", "Jordan");
    const fromPhoto = await page.evaluate(() => ({
      rsvp: document.querySelector("#coming [data-guest-name]").value,
      message: document.querySelector("#posts-body form [data-guest-name]").value,
      reply: document.querySelector("#posts-body .post [data-guest-name]").value,
      stored: localStorage.getItem("vols-tailgate-name"),
    }));
    assert.equal(fromPhoto.rsvp, "Jordan");
    assert.equal(fromPhoto.message, "Jordan");
    assert.equal(fromPhoto.reply, "Jordan");
    assert.equal(fromPhoto.stored, "Jordan");

    await page.click('[data-section="photos"] .acc-toggle');
    await page.waitForSelector(".shot-open img");
    assert.equal(await page.$eval(".shot-open img", (node) => node.alt), "Photo from Sample guest");
    const photosAxe = await axe(page);
    assert.deepEqual(photosAxe, [], JSON.stringify(photosAxe));

    await page.click('[aria-label="Open photo from Sample guest, tent-setup.png"]');
    await page.waitForSelector("#viewer:not([hidden])");
    await page.waitForFunction(() => {
      const image = document.querySelector("#viewer img");
      return image && image.alt === "Photo from Sample guest";
    });
    assert.equal(await page.$eval(".viewer-caption", (node) => node.textContent), "Photo from Sample guest");
    const viewerAxe = await axe(page, "#viewer");
    assert.deepEqual(viewerAxe, [], JSON.stringify(viewerAxe));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#viewer[hidden]");

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.click('[data-section="coming"] .acc-toggle');
    const wideComing = await axe(page);
    assert.deepEqual(wideComing, [], JSON.stringify(wideComing));
    await page.click('[data-section="photos"] .acc-toggle');
    const widePhotos = await axe(page);
    assert.deepEqual(widePhotos, [], JSON.stringify(widePhotos));
    await page.click('[data-section="posts"] .acc-toggle');
    const widePosts = await axe(page);
    assert.deepEqual(widePosts, [], JSON.stringify(widePosts));
    const wideInput = await page.$eval("#coming .input", (node) => Number.parseFloat(getComputedStyle(node).fontSize));
    assert.ok(wideInput >= 16, String(wideInput));

    await page.click("#owner-entry");
    await page.waitForSelector("#owner-key-input");
    await page.type("#owner-key-input", "sample-owner");
    await page.click("#owner-key-dialog button[type=submit]");
    await page.waitForFunction(() => document.getElementById("owner-chip-text").textContent === "Signed in as owner");
    await page.click("#owner-key-close");
    await page.waitForSelector("#owner-key-dialog[hidden]");
    const ownerStore = await page.evaluate(() => {
      const local = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        local[key] = localStorage.getItem(key);
      }
      return {
        local,
        session: sessionStorage.getItem("tailgate-owner-key-lsu-preview"),
      };
    });
    assert.equal(ownerStore.session, "sample-owner");
    for (const [key, value] of Object.entries(ownerStore.local)) {
      assert.equal(key.includes("owner"), false);
      assert.equal(String(value).includes("sample-owner"), false);
    }
    await page.click("#owner-sign-out");
    await page.waitForSelector("#owner-chip[hidden]");
    const afterOut = await page.evaluate(() => ({
      session: sessionStorage.getItem("tailgate-owner-key-lsu-preview"),
      guest: document.getElementById("guest-chip-text").textContent,
    }));
    assert.equal(afterOut.session, null);
    assert.equal(afterOut.guest, "Signed in as guest for LSU");

    if (!(await page.$eval("#acc-photos", (node) => node.classList.contains("open")))) {
      await page.click('[data-section="photos"] .acc-toggle');
    }
    await page.click("#forget-code");
    await page.waitForSelector('#photos-body input[placeholder="Guest code"]');
    const forgotten = await page.evaluate(() => ({
      guestHidden: document.getElementById("guest-chip").hidden,
      name: localStorage.getItem("vols-tailgate-name"),
      pin: localStorage.getItem("tailgate-media-pin-lsu-preview"),
    }));
    assert.equal(forgotten.guestHidden, true);
    assert.equal(forgotten.name, "Jordan");
    assert.equal(forgotten.pin, null);
    assert.deepEqual(leaks, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
