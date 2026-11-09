/* Knoxville game-day weather for LSU only.
   The National Weather Service /points and /forecast feeds cover about seven
   days. A period is shown only when its daytime start falls on the game date.
   Nothing here is a hardcoded temperature or rain chance. */
(function (root) {
  "use strict";

  var API_ORIGIN = "https://api.weather.gov/";

  function localDate(iso, timeZone) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function formatGameDate(gameDate, timeZone) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return gameDate;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(gameDate + "T17:00:00Z"));
  }

  function formatUpdated(iso, timeZone) {
    var date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "";
    var day = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      month: "long",
      day: "numeric",
    }).format(date);
    var time = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
    return "Forecast updated " + day + ", " + time + " ET";
  }

  function maxAgeMs(cacheControl) {
    var match = /max-age=(\d+)/i.exec(cacheControl || "");
    var seconds = match ? Number(match[1]) : 600;
    if (!Number.isFinite(seconds)) seconds = 600;
    return Math.min(Math.max(seconds, 60), 3600) * 1000;
  }

  function forecastUrlOk(url) {
    return /^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast$/.test(url);
  }

  function pointsUrl(weather) {
    if (!weather || !Number.isFinite(weather.latitude) || !Number.isFinite(weather.longitude)) return "";
    if (weather.latitude < -90 || weather.latitude > 90 || weather.longitude < -180 || weather.longitude > 180) return "";
    return API_ORIGIN + "points/" + weather.latitude.toFixed(4) + "," + weather.longitude.toFixed(4);
  }

  function failedView(place) {
    return {
      status: "failed",
      summary: "The " + (place || "Knoxville") + " forecast could not be loaded.",
      detail: "No temperature or rain chance is shown.",
    };
  }

  function buildView(input) {
    var timeZone = input.timeZone || "America/New_York";
    var periods = Array.isArray(input.periods) ? input.periods : [];
    var daytime = null;
    var latestStart = "";
    periods.forEach(function (period) {
      if (!period || typeof period.startTime !== "string") return;
      var startDate = localDate(period.startTime, timeZone);
      if (startDate && startDate > latestStart) latestStart = startDate;
      if (period.isDaytime === true && startDate === input.gameDate) daytime = period;
    });
    var updated = formatUpdated(input.updateTime, timeZone);
    var gameLabel = formatGameDate(input.gameDate, timeZone);
    if (!daytime) {
      return {
        status: "unavailable",
        summary: gameLabel + " is not in the National Weather Service forecast yet.",
        detail: latestStart
          ? "The latest forecast runs through " + formatGameDate(latestStart, timeZone) + ". It does not include a temperature or rain chance for the game."
          : "It does not include a temperature or rain chance for the game.",
        updated: updated,
      };
    }
    var temperature = "";
    if (typeof daytime.temperature === "number" && (daytime.temperatureUnit === "F" || daytime.temperatureUnit === "C")) {
      temperature = "Daytime temperature " + daytime.temperature + "\u00b0" + daytime.temperatureUnit;
    }
    var rain = "";
    var pop = daytime.probabilityOfPrecipitation;
    if (pop && typeof pop.value === "number") rain = "Chance of rain " + pop.value + "%";
    var conditions = typeof daytime.shortForecast === "string" ? daytime.shortForecast.trim() : "";
    if (!temperature && !rain && !conditions) {
      return {
        status: "unavailable",
        summary: gameLabel + " is not in the National Weather Service forecast yet.",
        detail: "It does not include a temperature or rain chance for the game.",
        updated: updated,
      };
    }
    return {
      status: "ready",
      summary: gameLabel + " daytime outlook",
      conditions: conditions,
      temperature: temperature,
      rain: rain,
      note: !input.kickoff || input.kickoff === "TBD"
        ? "Kickoff time is not set, so this is the daytime outlook rather than a specific hour."
        : "",
      updated: updated,
    };
  }

  function render(container, view) {
    var doc = container.ownerDocument;
    container.replaceChildren();
    ["summary", "detail", "conditions", "temperature", "rain", "note", "updated"].forEach(function (key) {
      if (typeof view[key] !== "string" || !view[key]) return;
      var paragraph = doc.createElement("p");
      paragraph.textContent = view[key];
      if (key === "updated") paragraph.className = "weather-updated";
      container.append(paragraph);
    });
  }

  function cacheKey(weather) {
    return "tailgate-nws:" + weather.gameDate + ":" + pointsUrl(weather);
  }

  function readCache(weather) {
    try {
      var raw = root.sessionStorage.getItem(cacheKey(weather));
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || !saved.view || saved.view.status === "failed") return null;
      if (typeof saved.savedAt !== "number" || typeof saved.maxAgeMs !== "number") return null;
      if (Date.now() - saved.savedAt >= saved.maxAgeMs) return null;
      return saved.view;
    } catch (error) {
      return null;
    }
  }

  function writeCache(weather, view, age) {
    if (!view || view.status === "failed") return;
    try {
      root.sessionStorage.setItem(cacheKey(weather), JSON.stringify({
        savedAt: Date.now(),
        maxAgeMs: age,
        view: view,
      }));
    } catch (error) {}
  }

  async function fetchJson(url) {
    var response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Weather request failed");
    if (!String(response.url || url).startsWith(API_ORIGIN)) throw new Error("Weather request left the National Weather Service");
    return {
      json: await response.json(),
      cacheControl: response.headers.get("cache-control"),
    };
  }

  async function load(weather, kickoff) {
    var body = root.document.getElementById("weather-body");
    if (!body) return;
    var cached = readCache(weather);
    if (cached) {
      render(body, cached);
      return;
    }
    var pointUrl = pointsUrl(weather);
    if (!pointUrl) throw new Error("Weather location is missing");
    var pointBody = await fetchJson(pointUrl);
    var forecast = pointBody.json && pointBody.json.properties && pointBody.json.properties.forecast;
    if (!forecastUrlOk(forecast)) throw new Error("Forecast address was not recognized");
    var forecastBody = await fetchJson(forecast);
    var props = (forecastBody.json && forecastBody.json.properties) || {};
    var view = buildView({
      gameDate: weather.gameDate,
      timeZone: weather.timeZone,
      periods: props.periods,
      updateTime: props.updateTime || props.generatedAt,
      kickoff: kickoff,
    });
    render(body, view);
    writeCache(weather, view, maxAgeMs(forecastBody.cacheControl));
  }

  root.TAILGATE_WEATHER = {
    localDate: localDate,
    buildView: buildView,
    maxAgeMs: maxAgeMs,
    forecastUrlOk: forecastUrlOk,
    pointsUrl: pointsUrl,
    formatUpdated: formatUpdated,
    failedView: failedView,
  };

  function boot() {
    var doc = root.document;
    if (!doc || !doc.body || doc.body.dataset.game !== "lsu") return;
    var games = root.TAILGATE_GAMES;
    var game = games && games.lsu;
    if (!game || !game.weather) return;
    var body = doc.getElementById("weather-body");
    load(game.weather, game.kickoff).catch(function () {
      if (body) render(body, failedView(game.weather.place));
    });
  }

  if (root.document) boot();
})(typeof window !== "undefined" ? window : this);
