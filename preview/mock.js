/* Sample data for the preview page. This never calls the live media host. */
(function () {
  var VIDEO = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAQtEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEfTbuMU6uEHFO7a1OsggQX7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECPQAAAAAAAFlSua8KuAQAAAAAAADnXgQFzxYg6U6x9sdERNpyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAJiWgDgirCCAUC6gbSagQISVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYwLjE2LjEwMHNz2mPAi2PFiDpTrH2x0RE2Z8ilRaOHRU5DT0RFUkSHmExhdmM2MC4zMS4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVCbOeBAKOngQAAgIJJg0IAE/ALNgA4JBwZLAAAMGAAABO/+eQAAblIYyRCch+Ao5aBACgAhgBAkhwAX+AAAyAAAFo1F64Qo5aBAFAAhgBAkhwAXcAAAyAAAFo1F64Qo5aBAHgAhgBAkhwAXUAAAyAAAFo1F64Qo5aBAKAAhgBAkhwAWoAAAyAAAFo1F64Qo5aBAMgAhgBAkpwAV+AAAyAAAFo1F64Qo5aBAPAAhgBAkpwAVUAAAyAAAFo1F64Qo5aBARgAhgBAkpwAVEAAAyAAAFo1F64Qo5aBAUAAhgBAkpwAU4AAAyAAAFo1F64Qo5aBAWgAhgBAkpwAUqAAAyAAAFo1F64Qo5aBAZAAhgDAkpwAToAAAyAAAFo1F64Qo5aBAbgAhgBAkpwAUcAAAyAAAFo1F64Qo5aBAeAAhgBAkpwAUQAAAyAAAFo1F64Qo5aBAggAhgBAkpwAUEAAAyAAAFo1F64Qo5aBAjAAhgBAkpwAT4AAAyAAAFo1F64Qo5aBAlgAhgBAkpwATuAAAyAAAFo1F64Qo5aBAoAAhgBAkpwATgAAAyAAAFo1F64Qo5aBAqgAhgBAkpwATUAAAyAAAFo1F64Qo5aBAtAAhgBAkpwATIAAAyAAAFo1F64Qo5aBAvgAhgBAkpwAS8AAAyAAAFo1F64Qo5aBAyAAhgDAkpwARmAAAyAAAFo1F64Qo5aBA0gAhgBAkpwASsAAAyAAAFo1F64Qo5aBA3AAhgBAkpwAScAAAyAAAFo1F64Qo5aBA5gAhgBAkpwASKAAAyAAAFo1F64Qo5aBA8AAhgBAkpwAR4AAAyAAAFo1F64QHFO7a5G7j7OBALeK94EB8YIBpfCBAw==";
  var files = [
    { id: "sample-tent", name: "tent-setup.png", contentType: "image/png", bytes: 48211, createdAt: "2026-11-21T15:10:00.000Z", uploadedBy: "Sample guest", preview: "image" },
    { id: "sample-song", name: "rocky-top.webm", contentType: "video/webm", bytes: 1117, createdAt: "2026-11-21T15:30:00.000Z", uploadedBy: "Sample guest", preview: "video" },
    { id: "sample-sign", name: "kiffin-sign.png", contentType: "image/png", bytes: 36004, createdAt: "2026-11-21T14:05:00.000Z", uploadedBy: "Sample guest", preview: "image", caption: "Kiffin sign for the lawn." },
    { id: "sample-lawn", name: "lawn.png", contentType: "image/png", bytes: 40112, createdAt: "2026-11-21T13:40:00.000Z", uploadedBy: "Sample guest", preview: "image" },
    { id: "sample-chairs", name: "chairs.png", contentType: "image/png", bytes: 38820, createdAt: "2026-11-21T13:20:00.000Z", uploadedBy: "Sample guest", preview: "image" },
    { id: "sample-cooler", name: "cooler.png", contentType: "image/png", bytes: 35210, createdAt: "2026-11-21T13:05:00.000Z", uploadedBy: "Sample guest", preview: "image" },
    { id: "sample-flag", name: "flag.png", contentType: "image/png", bytes: 29940, createdAt: "2026-11-21T12:40:00.000Z", uploadedBy: "Sample guest", preview: "image" },
    { id: "sample-table", name: "table.png", contentType: "image/png", bytes: 41002, createdAt: "2026-11-21T12:10:00.000Z", uploadedBy: "Sample guest", preview: "image" }
  ];
  var posts = [
    {
      id: "sample-post",
      name: "Sample guest",
      text: "Tent is up on the lawn.",
      createdAt: "2026-11-21T14:00:00.000Z",
      replies: [
        { id: "sample-reply", name: "Another guest", text: "On the way with ice.", createdAt: "2026-11-21T14:20:00.000Z" }
      ]
    },
    {
      id: "sample-with-photo",
      name: "Sample guest",
      text: "Bringing the cooler.",
      createdAt: "2026-11-21T15:40:00.000Z",
      replies: [],
      attachments: ["sample-cooler"]
    }
  ];
  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "content-type": "application/json" }
    }));
  }
  function png(label, color) {
    var canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 640;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 960, 640);
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 520, 960, 120);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 36px sans-serif";
    ctx.fillText(label, 36, 590);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, "image/png");
    });
  }
  function videoBlob() {
    var binary = atob(VIDEO);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "video/webm" });
  }
  function fileById(id) {
    for (var i = 0; i < files.length; i++) if (files[i].id === id) return files[i];
    return null;
  }
  function blobFor(file) {
    if (!file) return Promise.resolve(new Blob());
    if (file.preview === "video") return Promise.resolve(videoBlob());
    return png(file.name, file.id === "sample-sign" ? "#d0d0d0" : "#ff8200");
  }
  function handleMedia(url, init) {
    var parsed = new URL(url);
    var parts = parsed.pathname.split("/").filter(Boolean);
    var method = (init.method || "GET").toUpperCase();
    var headers = init.headers || {};
    function header(name) {
      if (typeof headers.get === "function") return headers.get(name) || "";
      var found = "";
      Object.keys(headers).forEach(function (key) {
        if (key.toLowerCase() === name) found = headers[key];
      });
      return found || "";
    }
    if (parts[0] !== "v1") return json({ error: "Not found." }, 404);
    if (parts[2] === "move-to-kentucky") {
      return json({
        error: "This preview does not contact the live site, so the move is not run from here.",
        files: null
      });
    }
    if (parts[2] === "files" && parts.length === 3 && method === "GET") return json({ files: files.slice() });
    if (parts[2] === "files" && parts.length === 4 && method === "GET") {
      var file = fileById(parts[3]);
      if (!file) return json({ error: "That file is gone." }, 404);
      return blobFor(file).then(function (blob) {
        return new Response(blob, { status: 200, headers: { "content-type": file.contentType } });
      });
    }
    if (parts[2] === "files" && parts.length === 4 && method === "DELETE") {
      if (!header("x-owner-token")) return json({ error: "Owner key was not accepted." }, 401);
      files = files.filter(function (item) { return item.id !== parts[3]; });
      return json({ ok: true });
    }
    if (parts[2] === "files" && method === "POST") return json({ error: "Uploads stay off in this preview." }, 403);
    if (parts[2] === "posts" && parts.length === 3 && method === "GET") return json({ posts: posts.slice() });
    if (parts[2] === "posts" && method === "POST") return json({ error: "Messages stay off in this preview." }, 403);
    if ((parts[2] === "rsvp" || parts[2] === "bring" || parts[2] === "donations") && method === "POST") {
      return json({
        ok: true,
        added: ["preview-row"],
        board: { revision: 2, signups: [], customItems: [], donations: [], attendees: [{ id: "preview-row", name: "Preview guest", guests: 1, note: "", createdAt: "2026-11-21T15:00:00.000Z", updatedAt: "2026-11-21T15:00:00.000Z" }] }
      });
    }
    if (parts[2] === "posts" && parts.length === 4 && method === "DELETE") {
      if (!header("x-owner-token")) return json({ error: "Owner key was not accepted." }, 401);
      posts = posts.filter(function (item) { return item.id !== parts[3]; });
      return json({ ok: true });
    }
    if (parts[2] === "posts" && parts.length === 6 && parts[4] === "replies" && method === "DELETE") {
      if (!header("x-owner-token")) return json({ error: "Owner key was not accepted." }, 401);
      posts.forEach(function (post) {
        if (post.id !== parts[3]) return;
        post.replies = (post.replies || []).filter(function (reply) { return reply.id !== parts[5]; });
      });
      return json({ ok: true });
    }
    return json({ error: "That action is not supported." }, 405);
  }
  function handleTelegraph(url) {
    if (url.indexOf("/getPage/") !== -1) {
      return json({
        ok: true,
        result: {
          content: [{ children: [JSON.stringify({ revision: 1, signups: [], customItems: [], donations: [], attendees: [] })] }]
        }
      });
    }
    return json({ ok: true, result: {} });
  }
  function handleWeather(url) {
    if (url.indexOf("/points/") !== -1) {
      return json({ properties: { forecast: "https://api.weather.gov/gridpoints/MRX/71,51/forecast" } });
    }
    return json({
      properties: {
        updateTime: "2026-11-19T12:00:00Z",
        periods: [
          { name: "Thursday", isDaytime: true, startTime: "2026-11-19T06:00:00-05:00", shortForecast: "Sunny", probabilityOfPrecipitation: { value: null } }
        ]
      }
    });
  }
  var original = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("workers.dev") !== -1) return Promise.reject(new Error("preview blocked the live media host"));
    if (url.indexOf("preview.invalid") !== -1) return handleMedia(url, init || {});
    if (url.indexOf("api.telegra.ph") !== -1) return handleTelegraph(url);
    if (url.indexOf("api.weather.gov") !== -1) return handleWeather(url);
    if (!original) return Promise.reject(new Error("preview has no network fetch"));
    return original(input, init);
  };
})();
