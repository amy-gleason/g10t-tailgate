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
assert.ok(!/teriyaki|1:15-2:15|feeds 20|High Noon|Nutrl|twelve-pack/i.test(lsu.foodNote));
assert.strictEqual(lsu.items.length, 0);
assert.strictEqual(
  JSON.stringify(lsu.covered.map((item) => item.name)),
  JSON.stringify(["Beer", "Seltzer", "Jack Fire"]),
);
assert.ok(lsu.covered[0].detail.includes("24 individual drinks"));
assert.ok(lsu.covered[1].detail.includes("24 individual drinks"));
assert.ok(!/high noon|nutrl|twelve-pack|brand/i.test(lsu.covered[1].detail) || /not a specific brand/i.test(lsu.covered[1].detail));
assert.ok(/not set/i.test(lsu.covered[2].detail));
assert.strictEqual(lsu.celebration, "Amy's 55th Birthday Celebration");
assert.strictEqual(lsu.seedAttendees, false);
assert.strictEqual(lsu.albumUrl, "");
assert.strictEqual(kentucky.albumUrl, "");
assert.ok(!alabama.albumUrl);

assert.ok(kentucky.foodNote.includes("Grilled Chicken Teriyaki"));
assert.strictEqual(kentucky.telegraphPath, "G10T-tailgate-Kentucky-10-26");
assert.ok(alabama.foodNote.startsWith("Ordered for 20:"));
assert.ok(alabama.items.some((item) => item.id === "cheese-slices"));
assert.ok(!lsu.items.some((item) => item.id === "high-noons" || item.id === "beer"));

assert.strictEqual(
  JSON.stringify(lsu.nav.map((link) => link.href)),
  JSON.stringify(["kentucky/", "alabama/"]),
);
assert.ok(kentucky.nav.some((link) => link.href === "../"));
assert.ok(kentucky.nav.some((link) => link.href === "../alabama/"));
assert.ok(alabama.nav.some((link) => link.href === "../kentucky/"));

assert.ok(appSource.includes("This game is pointed at the Kentucky list."));
assert.ok(appSource.includes("This game is pointed at the Alabama list."));
assert.ok(appSource.includes('if (/^https:\\/\\//.test(game.albumUrl || ""))'));
assert.ok(!/type="file"|upload photo|upload video/i.test(appSource));
assert.ok(!/shared photos and videos/i.test(gamesSource));

console.log("isolation checks passed");
