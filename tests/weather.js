"use strict";

const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync("weather.js", "utf8"), context);
const weather = context.window.TAILGATE_WEATHER;
const zone = "America/New_York";

assert.strictEqual(weather.pointsUrl({ latitude: 35.955, longitude: -83.925 }), "https://api.weather.gov/points/35.9550,-83.9250");
assert.strictEqual(weather.forecastUrlOk("https://api.weather.gov/gridpoints/MRX/71,51/forecast"), true);
assert.strictEqual(weather.forecastUrlOk("https://example.com/gridpoints/MRX/71,51/forecast"), false);
assert.strictEqual(weather.forecastUrlOk("http://api.weather.gov/gridpoints/MRX/71,51/forecast"), false);
assert.strictEqual(weather.maxAgeMs("public, max-age=240, s-maxage=3600"), 240000);
assert.strictEqual(weather.maxAgeMs("max-age=86400"), 3600000);
assert.strictEqual(weather.maxAgeMs(""), 600000);
assert.strictEqual(weather.formatUpdated("2026-11-08T23:06:12+00:00", zone), "Forecast updated November 8, 6:06 PM ET");
assert.strictEqual(weather.localDate("2026-11-21T06:00:00-05:00", zone), "2026-11-21");
assert.strictEqual(weather.localDate("2026-11-21T04:00:00Z", zone), "2026-11-20");

const early = weather.buildView({
  gameDate: "2026-11-21",
  timeZone: zone,
  kickoff: "TBD",
  updateTime: "2026-11-08T23:06:12+00:00",
  periods: [
    { name: "Saturday", isDaytime: true, startTime: "2026-11-14T06:00:00-05:00", temperature: 50, temperatureUnit: "F", shortForecast: "Mostly Sunny", probabilityOfPrecipitation: { value: 4 } },
    { name: "Sunday", isDaytime: true, startTime: "2026-11-15T06:00:00-05:00", temperature: 57, temperatureUnit: "F", shortForecast: "Sunny", probabilityOfPrecipitation: { value: 0 } },
  ],
});
assert.strictEqual(early.status, "unavailable");
assert.ok(early.summary.includes("Saturday, November 21, 2026"));
assert.ok(early.detail.includes("Sunday, November 15, 2026"));
assert.ok(!JSON.stringify(early).includes("50"));
assert.ok(!JSON.stringify(early).includes("57"));
assert.ok(!early.temperature);
assert.ok(!early.rain);
assert.strictEqual(early.updated, "Forecast updated November 8, 6:06 PM ET");

// TEST ONLY. 61°F and 15% are fixture values, not a forecast.
const ready = weather.buildView({
  gameDate: "2026-11-21",
  timeZone: zone,
  kickoff: "TBD",
  updateTime: "2026-11-19T15:00:00Z",
  periods: [
    { name: "Friday", isDaytime: true, startTime: "2026-11-20T06:00:00-05:00", temperature: 48, temperatureUnit: "F", shortForecast: "Cloudy", probabilityOfPrecipitation: { value: 40 } },
    { name: "Saturday", isDaytime: true, startTime: "2026-11-21T06:00:00-05:00", temperature: 61, temperatureUnit: "F", shortForecast: "Partly Cloudy", probabilityOfPrecipitation: { value: 15 } },
    { name: "Saturday Night", isDaytime: false, startTime: "2026-11-21T18:00:00-05:00", temperature: 40, temperatureUnit: "F", shortForecast: "Clear", probabilityOfPrecipitation: { value: 0 } },
  ],
});
assert.strictEqual(ready.status, "ready");
assert.strictEqual(ready.conditions, "Partly Cloudy");
assert.strictEqual(ready.temperature, "Daytime temperature 61°F");
assert.strictEqual(ready.rain, "Chance of rain 15%");
assert.ok(ready.note.includes("Kickoff time is not set"));
assert.ok(!JSON.stringify(ready).includes("48"));
assert.ok(!JSON.stringify(ready).includes("40°"));

const noRain = weather.buildView({
  gameDate: "2026-11-21",
  timeZone: zone,
  kickoff: "TBD",
  updateTime: "2026-11-19T15:00:00Z",
  periods: [
    { name: "Saturday", isDaytime: true, startTime: "2026-11-21T06:00:00-05:00", temperature: 61, temperatureUnit: "F", shortForecast: "Partly Cloudy", probabilityOfPrecipitation: { value: null } },
  ],
});
assert.strictEqual(noRain.rain, "");

const nightOnly = weather.buildView({
  gameDate: "2026-11-21",
  timeZone: zone,
  kickoff: "TBD",
  periods: [
    { name: "Saturday Night", isDaytime: false, startTime: "2026-11-21T18:00:00-05:00", temperature: 40, temperatureUnit: "F", shortForecast: "Clear", probabilityOfPrecipitation: { value: 0 } },
  ],
});
assert.strictEqual(nightOnly.status, "unavailable");
assert.ok(!JSON.stringify(nightOnly).includes("40"));

const failed = weather.failedView("Knoxville");
assert.strictEqual(failed.status, "failed");
assert.ok(!failed.temperature);
assert.ok(!failed.rain);

console.log("weather checks passed");
