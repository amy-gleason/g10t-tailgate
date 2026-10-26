/* Per-game tailgate config.
   To add a game later (for example LSU): add one entry to the list below,
   create an empty Telegraph page, and copy alabama/index.html to
   <id>/index.html with data-game set to that id.
   Never change the Alabama telegraphPath. That path is the October 17 list. */
(function () {
  var MENU =
    "Hamburgers, Hotdogs, Lettuce, Tomato, Onion & Condiments, Mac N Cheese, Rolls w/ Honey Cinnamon Butter, Assorted Cookies, 1 dozen frosted chocolate chip cookies, Peanuts.";
  var LEADS = [
    "You're welcome to just show up! Several of you have asked how to contribute and what's needed, so we're trying this to see if it helps.",
    "Tailgate includes: tent, TV, 20 folding chairs, two tables, 2 coolers and ice.",
  ];
  var ITEMS = [
    { id: "cheese-slices", name: "Cheese slices", singular: "slice", plural: "slices", target: null, hint: "For burgers", countHint: "Count slices.", section: "food" },
    { id: "red-bull", name: "Red Bull", singular: "can", plural: "cans", target: 6, hint: "For Vol bombs", countHint: "Count cans.", section: "drink" },
    { id: "orange-vodka", name: "Orange vodka", singular: "bottle", plural: "bottles", target: 1, hint: "For Vol bombs", countHint: "Count bottles.", section: "drink" },
    { id: "vodka", name: "Vodka", singular: "bottle", plural: "bottles", target: 1, hint: "", countHint: "Count bottles.", section: "drink" },
    { id: "champagne", name: "Champagne", singular: "bottle", plural: "bottles", target: 4, hint: "", countHint: "Count bottles.", section: "drink" },
    { id: "dolly-shots", name: "Dolly shots", singular: "bottle", plural: "bottles", target: 1, hint: "For Megan", countHint: "Count bottles.", section: "drink" },
    { id: "beer", name: "Beer", singular: "twelve-pack", plural: "twelve-packs", target: 3, hint: "Any beer is fine", countHint: "Count twelve-packs, not single cans.", section: "drink" },
    { id: "high-noons", name: "High Noons", singular: "can", plural: "cans", target: 36, hint: "Pineapple, peach, or black cherry. Not grapefruit.", countHint: "Count cans. One 12-pack is 12.", section: "drink" },
    { id: "nutrl", name: "Nutrl", singular: "can", plural: "cans", target: 36, hint: "Pineapple or watermelon.", countHint: "Count cans. One 12-pack is 12.", section: "drink" },
    { id: "hard-mountain-dew", name: "Hard Mountain Dew", singular: "twelve-pack", plural: "twelve-packs", target: 2, hint: "", countHint: "Count twelve-packs, not single cans.", section: "drink" },
    { id: "diet-soda", name: "Diet soda", singular: "can", plural: "cans", target: 12, hint: "Any diet soda", countHint: "Count cans. A 12-pack is 12.", section: "drink" },
    { id: "regular-soda", name: "Regular soda", singular: "can", plural: "cans", target: 12, hint: "Any regular soda", countHint: "Count cans. A 12-pack is 12.", section: "drink" },
    { id: "water", name: "Water", singular: "twelve-pack", plural: "twelve-packs", target: 2, hint: "Small bottles", countHint: "Count twelve-packs of small bottles.", section: "drink" },
    { id: "pineapple-juice", name: "Pineapple juice", singular: "bottle", plural: "bottles", target: 1, hint: "", countHint: "Count bottles.", section: "drink" },
    { id: "cranberry-juice", name: "Cranberry juice", singular: "bottle", plural: "bottles", target: 1, hint: "", countHint: "Count bottles.", section: "drink" },
  ];
  var LOCATION = {
    title: "Smokey Blue Lawn, space SB10",
    lines: [
      "McClung Tower, on the side facing Hodges Library. University of Tennessee, Knoxville.",
    ],
    mapsUrl:
      "https://www.google.com/maps/search/?api=1&query=McClung%20Tower%2C%20University%20of%20Tennessee%2C%20Knoxville",
    notes: [
      "Ubering? Get dropped off at Hodges Library, which is closest.",
      "Amy has load-in passes that let you drop off items and then go park. Ask Amy if you want one.",
      "The load-in area is on Volunteer Blvd. Show your pass.",
    ],
    mapHint: "Tap a map to enlarge it.",
    maps: [
      {
        src: "maps/sb-lot-map.jpg",
        alt: "Smokey Blue lot map with space SB10 marked",
        caption: "Smokey Blue lot map",
        width: 1206,
        height: 889,
      },
      {
        src: "maps/campus-map.jpg",
        alt: "Campus overview with McClung Tower and Hodges Library",
        caption: "Campus overview",
        width: 903,
        height: 507,
      },
    ],
  };

  function itemsFor(clearHints) {
    var skip = {};
    (clearHints || []).forEach(function (id) {
      skip[id] = true;
    });
    return ITEMS.map(function (item) {
      return skip[item.id] ? Object.assign({}, item, { hint: "" }) : item;
    });
  }

  function locationFor(status) {
    var loc = Object.assign({}, LOCATION);
    if (status) loc.status = status;
    return loc;
  }

  window.TAILGATE_GAMES = {
    alabama: {
      id: "alabama",
      telegraphPath: "G10T-tailgate-data-10-15",
      telegraphTitle: "G10T tailgate data",
      pageTitle: "G10T Eviction Party",
      description:
        "Signup list for the G10T Eviction Party at Smokey Blue Lawn SB10, Saturday, October 17, 2026.",
      banner: "Alabama Hate Week",
      date: "Saturday, October 17, 2026",
      heading: "G10T Eviction Party, Smokey Blue Lawn SB10",
      leads: LEADS,
      foodNote: "Ordered for 20: " + MENU,
      items: itemsFor(),
      location: locationFor(),
      locationPlacement: "accordion",
      seedAttendees: true,
      past: true,
      currentGame: { href: "../", label: "Current game" },
    },
    kentucky: {
      id: "kentucky",
      telegraphPath: "G10T-tailgate-Kentucky-10-26",
      telegraphTitle: "G10T tailgate Kentucky",
      pageTitle: "Tennessee vs Kentucky",
      description:
        "Signup list for the Tennessee vs Kentucky tailgate at Neyland Stadium, Saturday, November 7, 2026.",
      banner: "Tennessee vs Kentucky",
      date: "Saturday, November 7, 2026",
      kickoff: "TBA (6-8 PM ET window)",
      heading: "Tennessee vs Kentucky, Neyland Stadium",
      leads: LEADS,
      foodNote: "Food plan coming soon: " + MENU,
      items: itemsFor(["dolly-shots"]),
      location: locationFor("confirm"),
      locationPlacement: "top",
      seedAttendees: false,
      past: false,
      pastTailgates: { href: "alabama/", label: "Past tailgates" },
    },
  };
})();
