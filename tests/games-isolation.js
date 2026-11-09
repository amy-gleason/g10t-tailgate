"use strict";

const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const gamesSource = fs.readFileSync("games.js", "utf8");
const appSource = fs.readFileSync("tailgate.js", "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(gamesSource, context);
const games = context.window.TAILGATE_GAMES;

const alabama = games.alabama;
const kentucky = games.kentucky;
const lsu = games.lsu;
const paths = [alabama.telegraphPath, kentucky.telegraphPath, lsu.telegraphPath];

assert.strictEqual(
  JSON.stringify(paths),
  JSON.stringify([
    "G10T-tailgate-data-10-15",
    "G10T-tailgate-Kentucky-10-26",
    "G10T-tailgate-LSU-11-08",
  ]),
);
assert.strictEqual(new Set(paths).size, 3);

assert.strictEqual(lsu.kickoff, "TBD");
assert.strictEqual(lsu.schedule, undefined);
assert.strictEqual(
  lsu.foodNote,
  "Menu: Hamburgers, Hotdogs, Lettuce, Tomato, Onion & Condiments, Mac N Cheese, Rolls w/ Honey Cinnamon Butter, Assorted Cookies, 1 dozen frosted chocolate chip cookies, Peanuts.",
);
assert.ok(!lsu.foodNote.includes("Ordered for 20"));
assert.ok(!/not confirmed|order placed|cater/i.test(lsu.foodNote));
assert.ok(!/teriyaki|1:15-2:15|feeds 20|High Noon|Nutrl|twelve-pack/i.test(lsu.foodNote));
assert.strictEqual(
  JSON.stringify(lsu.items.map((item) => [item.name, item.target, item.section])),
  JSON.stringify([
    ["Mustard bottles", null, "food"],
    ["Golf balls", null, "food"],
  ]),
);
assert.ok(!lsu.covered.some((item) => /mustard|golf/i.test(item.name)));
assert.ok(!kentucky.items.some((item) => item.id === "mustard-bottles" || item.id === "golf-balls"));
assert.ok(!alabama.items.some((item) => item.id === "mustard-bottles" || item.id === "golf-balls"));
assert.strictEqual(
  JSON.stringify(lsu.covered.map((item) => item.name)),
  JSON.stringify(["Beer", "Seltzer", "Jack Fire"]),
);
assert.ok(lsu.covered[0].detail.includes("24 individual drinks"));
assert.ok(lsu.covered[1].detail.includes("24 individual drinks"));
assert.ok(!/high noon|nutrl|twelve-pack|brand/i.test(lsu.covered[1].detail) || /not a specific brand/i.test(lsu.covered[1].detail));
assert.ok(/not set/i.test(lsu.covered[2].detail));
assert.strictEqual(lsu.celebration, "(also Amy\u2019s 55th birthday)");
assert.strictEqual(lsu.banner, "Tennessee vs LSU");
assert.ok(!kentucky.celebration && !alabama.celebration);
assert.strictEqual(lsu.seedAttendees, false);
assert.strictEqual(lsu.media, true);
assert.strictEqual(lsu.mediaApi, "https://g10t-tailgate-media.g10t-tailgate.workers.dev");
assert.strictEqual(kentucky.media, true);
assert.strictEqual(kentucky.mediaApi, lsu.mediaApi);
assert.ok(!alabama.media);
assert.ok(!alabama.mediaApi);

assert.ok(kentucky.foodNote.includes("Grilled Chicken Teriyaki"));
assert.strictEqual(kentucky.telegraphPath, "G10T-tailgate-Kentucky-10-26");
assert.ok(alabama.foodNote.startsWith("Ordered for 20:"));
assert.ok(alabama.items.some((item) => item.id === "cheese-slices"));
assert.ok(!lsu.items.some((item) => item.id === "high-noons" || item.id === "beer"));

assert.strictEqual(
  JSON.stringify(lsu.gamesMenu.map((link) => link.label)),
  JSON.stringify(["LSU", "Kentucky", "Alabama"]),
);
assert.strictEqual(lsu.gamesMenu[0].href, "./");
assert.strictEqual(lsu.gamesMenu[0].current, true);
assert.ok(kentucky.gamesMenu.some((link) => link.label === "LSU" && link.href === "../" && !link.current));
assert.ok(kentucky.gamesMenu.some((link) => link.label === "Kentucky" && link.current));
assert.ok(alabama.gamesMenu.some((link) => link.label === "Alabama" && link.current && link.href === "../alabama/"));
assert.ok(!lsu.pastGames && !kentucky.pastGames && !alabama.pastGames);
assert.ok(!appSource.includes("past-games"));
assert.ok(appSource.includes('aria-label": "Games"'));

assert.ok(appSource.includes("This game is pointed at the Kentucky list."));
assert.ok(appSource.includes("This game is pointed at the Alabama list."));
assert.ok(!appSource.includes("albumUrl"));
assert.ok(!/shared photos and videos/i.test(gamesSource));
const client = fs.readFileSync("media-client.js", "utf8");
assert.ok(client.includes("Photos and videos aren't available yet"));
assert.ok(client.includes("Messages aren't available yet"));
assert.ok(client.includes("Send message"));
assert.ok(client.includes("localhost"));
assert.ok(!client.includes("local-test-pin"));

console.log("isolation checks passed");
