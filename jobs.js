/* Phone navigation for the four guest jobs. Desktop keeps the section list. */
(function () {
  var gameId = document.body && document.body.dataset.game;
  var game = (window.TAILGATE_GAMES || {})[gameId];
  var main = document.querySelector("main");
  if (!game || !main) return;

  var jobs = [
    { id: "game", label: "Game", mark: "⌂" },
    { id: "rsvp", label: "RSVP", mark: "🙋" },
    { id: "bring", label: "Bring", mark: "🧺" },
  ];
  if (game.media) {
    jobs.push({ id: "photos", label: "Photos", mark: "📷" });
    jobs.push({ id: "messages", label: "Messages", mark: "💬" });
  }

  var sectionsFor = {
    game: [],
    rsvp: ["coming"],
    bring: ["food", "other", "drinks", "donations"],
    photos: ["photos"],
    messages: ["posts"],
  };
  var fromHash = {
    coming: "rsvp",
    food: "bring",
    drinks: "bring",
    donations: "bring",
    other: "bring",
    photos: "photos",
    posts: "messages",
  };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") node.className = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(child));
    }
    return node;
  }

  var cards = el("div", { class: "job-cards", id: "job-cards" });
  [
    ["rsvp", "I'm coming", "🙋", "job-count-rsvp", "Who's coming", true],
    ["bring", "Bring something", "🧺", "job-count-bring", "Food, drinks, and more", false],
    ["photos", "Photos & videos", "📷", "job-count-photos", "See what was shared", false],
    ["messages", "Messages", "💬", "job-count-messages", "Notes for this game", false],
  ].forEach(function (item) {
    if ((item[0] === "photos" || item[0] === "messages") && !game.media) return;
    var count = el("span", { id: item[3] }, item[4]);
    var card = el("button", {
      type: "button",
      class: item[5] ? "job-card hot" : "job-card",
      "data-job-card": item[0],
    }, el("span", { class: "job-mark", "aria-hidden": "true" }, item[2]), el("b", null, item[1]), count);
    card.addEventListener("click", function () { select(item[0], true); });
    cards.append(card);
  });
  var heading = main.querySelector("h1");
  if (heading && heading.nextSibling) main.insertBefore(cards, heading.nextSibling);
  else main.insertBefore(cards, main.firstChild);

  var tabs = [];
  var tablist = el("div", { class: "job-tabs", role: "tablist", "aria-label": "Game sections" });
  jobs.forEach(function (job, index) {
    var tab = el("button", {
      type: "button",
      class: "job-tab",
      role: "tab",
      id: "job-tab-" + job.id,
      "data-job-tab": job.id,
      "aria-selected": "false",
      tabindex: "-1",
    }, el("span", { class: "job-mark", "aria-hidden": "true" }, job.mark), el("span", null, job.label));
    tab.addEventListener("click", function () { select(job.id, false); });
    tab.addEventListener("keydown", function (event) {
      var nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % jobs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index + jobs.length - 1) % jobs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = jobs.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      select(jobs[nextIndex].id, false);
      tabs[nextIndex].focus();
    });
    tabs.push(tab);
    tablist.append(tab);
  });
  document.body.append(tablist);

  var current = "game";
  function phoneOn() {
    return window.matchMedia("(max-width: 899px)").matches;
  }
  function showPanels(ids) {
    document.querySelectorAll(".acc").forEach(function (acc) {
      var id = acc.getAttribute("data-section");
      var open = ids.indexOf(id) !== -1;
      var panel = acc.querySelector(".acc-panel");
      if (!panel) return;
      if (open) panel.hidden = false;
    });
  }
  function select(job, focusTab) {
    if (!sectionsFor[job]) job = "game";
    current = job;
    document.body.dataset.job = job;
    document.body.classList.toggle("phone-jobs", phoneOn());
    if (!phoneOn()) document.body.removeAttribute("data-job");
    tabs.forEach(function (tab) {
      var on = tab.getAttribute("data-job-tab") === job;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus();
    });
    showPanels(sectionsFor[job] || []);
    paintCounts();
  }
  function paintCounts() {
    var total = document.querySelector(".total-n");
    var coming = document.getElementById("job-count-rsvp");
    if (coming && total && total.textContent) coming.textContent = total.textContent + " people so far";
    var photos = document.querySelectorAll("#photos-body .photo-grid > article, #photos-body .gallery > article").length;
    var photoCount = document.getElementById("job-count-photos");
    if (photoCount) photoCount.textContent = photos ? photos + " shared" : "See what was shared";
    var posts = document.querySelectorAll("#posts-body .post").length;
    var messageCount = document.getElementById("job-count-messages");
    if (messageCount) messageCount.textContent = posts ? posts + " posted" : "Notes for this game";
  }
  var start = fromHash[(location.hash || "").replace("#", "")] || "game";
  select(start, false);
  window.addEventListener("hashchange", function () {
    var next = fromHash[(location.hash || "").replace("#", "")];
    if (next) select(next, false);
  });
  var phoneQuery = window.matchMedia("(max-width: 899px)");
  if (phoneQuery.addEventListener) phoneQuery.addEventListener("change", function () { select(current, false); });
  window.setInterval(paintCounts, 1500);
  paintCounts();
})();
