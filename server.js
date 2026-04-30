import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { downloadAllFeeds, parseCSV } from "./gtfs/loader.js";
import { buildGraph, findRoutes, findDepartures } from "./gtfs/index.js";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5500;

// Live reload: track file modification times
const WATCH_DIRS = [__dirname, path.join(__dirname, "gtfs")];
let fileVersion = Date.now();

function startFileWatcher() {
  for (const dir of WATCH_DIRS) {
    try {
      fs.watch(dir, { recursive: true }, (event, filename) => {
        if (filename && (filename.endsWith(".js") || filename.endsWith(".css") || filename.endsWith(".html"))) {
          fileVersion = Date.now();
          console.log(`[live-reload] ${filename} changed`);
        }
      });
    } catch (e) {
      // ignore watch errors
    }
  }
}

startFileWatcher();

function getBudapestDistrict(lat, lon) {
  const districts = [
    { roman: "IV", name: "Újpest", lat: [47.550, 47.580], lon: [19.080, 19.150] },
    { roman: "XIII", name: "", lat: [47.510, 47.550], lon: [19.030, 19.095] },
    { roman: "I", name: "Várkerület", lat: [47.490, 47.505], lon: [19.015, 19.045] },
    { roman: "II", name: "", lat: [47.500, 47.555], lon: [18.990, 19.070] },
    { roman: "III", name: "Óbuda-Békásmegyer", lat: [47.530, 47.590], lon: [19.015, 19.085] },
    { roman: "V", name: "Belváros-Lipótváros", lat: [47.488, 47.510], lon: [19.045, 19.075] },
    { roman: "VI", name: "Terézváros", lat: [47.500, 47.515], lon: [19.055, 19.085] },
    { roman: "VII", name: "Erzsébetváros", lat: [47.490, 47.502], lon: [19.065, 19.090] },
    { roman: "VIII", name: "Józsefváros", lat: [47.485, 47.500], lon: [19.075, 19.115] },
    { roman: "IX", name: "Ferencváros", lat: [47.465, 47.492], lon: [19.055, 19.120] },
    { roman: "X", name: "Kőbánya", lat: [47.475, 47.510], lon: [19.120, 19.185] },
    { roman: "XI", name: "Újbuda", lat: [47.455, 47.495], lon: [19.020, 19.070] },
    { roman: "XII", name: "Hegyvidék", lat: [47.475, 47.530], lon: [18.955, 19.025] },
    { roman: "XIV", name: "Zugló", lat: [47.510, 47.540], lon: [19.090, 19.150] },
    { roman: "XV", name: "Rákospalota", lat: [47.530, 47.560], lon: [19.135, 19.195] },
    { roman: "XVI", name: "", lat: [47.515, 47.550], lon: [19.185, 19.270] },
    { roman: "XVII", name: "Rákosmente", lat: [47.495, 47.540], lon: [19.230, 19.310] },
    { roman: "XVIII", name: "Pestszentlőrinc", lat: [47.445, 47.495], lon: [19.175, 19.240] },
    { roman: "XIX", name: "Kispest", lat: [47.455, 47.485], lon: [19.125, 19.180] },
    { roman: "XX", name: "Pesterzsébet", lat: [47.435, 47.470], lon: [19.115, 19.170] },
    { roman: "XXI", name: "Csepel", lat: [47.395, 47.445], lon: [19.050, 19.125] },
    { roman: "XXII", name: "Budafok-Tétény", lat: [47.425, 47.465], lon: [18.980, 19.055] },
    { roman: "XXIII", name: "Soroksár", lat: [47.420, 47.455], lon: [19.115, 19.185] },
  ];

  for (const d of districts) {
    if (lat >= d.lat[0] && lat <= d.lat[1] && lon >= d.lon[0] && lon <= d.lon[1]) {
      return `Budapest, ${d.roman}. kerület${d.name ? " (" + d.name + ")" : ""}`;
    }
  }
  return null;
}

const BUDAPEST_DISTRICTS = [
  { label: "I. kerület – Várkerület", roman: "I", query: "I. kerulet", search: "var", number: 1 },
  { label: "II. kerület", roman: "II", query: "II. kerulet", search: "", number: 2 },
  { label: "III. kerület – Óbuda-Békásmegyer", roman: "III", query: "III. kerulet", search: "obuda", number: 3 },
  { label: "IV. kerület – Újpest", roman: "IV", query: "IV. kerulet", search: "ujpest", number: 4 },
  { label: "V. kerület – Belváros-Lipótváros", roman: "V", query: "V. kerulet", search: "belvaros", number: 5 },
  { label: "VI. kerület – Terézváros", roman: "VI", query: "VI. kerulet", search: "terezvaros", number: 6 },
  { label: "VII. kerület – Erzsébetváros", roman: "VII", query: "VII. kerulet", search: "erzsebetvaros", number: 7 },
  { label: "VIII. kerület – Józsefváros", roman: "VIII", query: "VIII. kerulet", search: "jozsefvaros", number: 8 },
  { label: "IX. kerület – Ferencváros", roman: "IX", query: "IX. kerulet", search: "ferencvaros", number: 9 },
  { label: "X. kerület – Kőbánya", roman: "X", query: "X. kerulet", search: "kobanya", number: 10 },
  { label: "XI. kerület – Újbuda", roman: "XI", query: "XI. kerulet", search: "ujbuda", number: 11 },
  { label: "XII. kerület – Hegyvidék", roman: "XII", query: "XII. kerulet", search: "hegyvidek", number: 12 },
  { label: "XIII. kerület", roman: "XIII", query: "XIII. kerulet", search: "", number: 13 },
  { label: "XIV. kerület – Zugló", roman: "XIV", query: "XIV. kerulet", search: "zuglo", number: 14 },
  { label: "XV. kerület – Rákospalota", roman: "XV", query: "XV. kerulet", search: "rakospalota", number: 15 },
  { label: "XVI. kerület", roman: "XVI", query: "XVI. kerulet", search: "", number: 16 },
  { label: "XVII. kerület – Rákosmente", roman: "XVII", query: "XVII. kerulet", search: "rakosmente", number: 17 },
  { label: "XVIII. kerület – Pestszentlőrinc", roman: "XVIII", query: "XVIII. kerulet", search: "pestszentlorinc", number: 18 },
  { label: "XIX. kerület – Kispest", roman: "XIX", query: "XIX. kerulet", search: "kispest", number: 19 },
  { label: "XX. kerület – Pesterzsébet", roman: "XX", query: "XX. kerulet", search: "pesterzsebet", number: 20 },
  { label: "XXI. kerület – Csepel", roman: "XXI", query: "XXI. kerulet", search: "csepel", number: 21 },
  { label: "XXII. kerület – Budafok-Tétény", roman: "XXII", query: "XXII. kerulet", search: "budafok", number: 22 },
  { label: "XXIII. kerület – Soroksár", roman: "XXIII", query: "XXIII. kerulet", search: "soroksar", number: 23 },
];

const ROMAN_TO_NUMBER = {
  "i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5,
  "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10,
  "xi": 11, "xii": 12, "xiii": 13, "xiv": 14, "xv": 15,
  "xvi": 16, "xvii": 17, "xviii": 18, "xix": 19, "xx": 20,
  "xxi": 21, "xxii": 22, "xxiii": 23,
};

function parseDistrictNumber(query) {
  const trimmed = query.trim();
  const numMatch = trimmed.match(/^(\d{1,2})\.?$/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    if (num >= 1 && num <= 23) return num;
  }
  const roman = trimmed.toLowerCase();
  if (ROMAN_TO_NUMBER[roman]) return ROMAN_TO_NUMBER[roman];
  const bpMatch = trimmed.match(/^budapest\s+([ivx]+)$/i);
  if (bpMatch) {
    const r = bpMatch[1].toLowerCase();
    if (ROMAN_TO_NUMBER[r]) return ROMAN_TO_NUMBER[r];
  }
  const bpNumMatch = trimmed.match(/^budapest\s+(\d{1,2})\.?$/);
  if (bpNumMatch) {
    const num = parseInt(bpNumMatch[1]);
    if (num >= 1 && num <= 23) return num;
  }
  return null;
}

function normalizeSearch(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,\.\-\–—\(\)\[\]\/\\'\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let graph = null;
let graphReady = false;
let downloadProgress = { bkk: "pending", volanbusz: "pending" };

async function initGraph() {
  try {
    console.log("Initializing GTFS data...");
    const feedDirs = await downloadAllFeeds();
    downloadProgress = { bkk: "ready", volanbusz: "ready" };

    graph = await buildGraph(feedDirs);
    graphReady = true;
    console.log("Graph ready!");
  } catch (err) {
    console.error("Failed to build graph:", err.message);
  }
}

initGraph();

app.get("/api/version", (req, res) => {
  res.json({ version: fileVersion });
});

app.get("/api/status", (req, res) => {
  res.json({
    ready: graphReady,
    feeds: downloadProgress,
  });
});

app.get("/api/stations", async (req, res) => {
  if (!graphReady) {
    return res.status(503).json({ error: "Graph not ready" });
  }

  const { q, type } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  const query = normalizeSearch(q);
  const results = [];
  const seen = new Set();
  const maxCheck = 300000;
  let checked = 0;

  // Check if this is a district-specific query
  const districtNum = parseDistrictNumber(query);
  const districtFilter = districtNum ? BUDAPEST_DISTRICTS.find(d => d.number === districtNum) : null;

  // Check for regular district match (e.g., "ferencvaros", "ujpest")
  const nameMatchDistrict = !districtFilter ? BUDAPEST_DISTRICTS.find(d =>
    (d.search && normalizeSearch(d.search) === query) ||
    normalizeSearch(d.query) === query ||
    normalizeSearch(d.label) === query
  ) : null;
  const activeDistrictFilter = nameMatchDistrict || districtFilter;

  // Is this a "budapest" search (with or without district)?
  const isBudapestSearch = query === "budapest" || query.startsWith("budapest ") || !!districtNum;
  const isPureBudapest = query === "budapest";

  for (const [stopId, stop] of graph.stops) {
    if (checked >= maxCheck) break;
    checked++;

    if (!graph.stopTimesIndex.has(stopId)) continue;

    const name = normalizeSearch(stop.stop_name || "");
    const desc = normalizeSearch(stop.stop_desc || "");
    const district = getBudapestDistrict(stop.lat, stop.lon);
    const isInBudapest = district !== null;

    let score = 0;

    if (activeDistrictFilter) {
      // Only show stops in the specific district
      if (!isInBudapest) continue;
      // Match roman numeral followed by period (e.g., "IV." in "Budapest, IV. kerület")
      const romanMatch = district.match(/,\s*([IVX]+)\./);
      const stopRoman = romanMatch ? romanMatch[1] : null;
      const d = stopRoman ? BUDAPEST_DISTRICTS.find(dd => dd.roman === stopRoman) : null;
      if (!d || d.number !== activeDistrictFilter.number) continue;
      score = 10;
      if (name === query) score = 1000;
      else if (name.startsWith(query)) score = Math.max(score, 500);
      else if (name.includes(query)) score = Math.max(score, 100);
    } else if (isPureBudapest) {
      // "budapest" alone: show all BP stops
      if (!isInBudapest) continue;
      score = 1; // baseline for being in BP
      // Boost if name also matches "budapest"
      if (name.includes("budapest")) score = 100;
    } else {
      // Regular search
      if (name === query) score = 1000;
      else if (name.startsWith(query)) score = 500;
      else if (name.includes(query)) score = 100;
      else if (desc.includes(query)) score = 50;
      else continue;
    }

    const key = stop.stop_name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      stopId,
      stopName: stop.stop_name,
      stopDesc: stop.stop_desc || "",
      lat: stop.lat,
      lon: stop.lon,
      source: stop.source,
      district,
      score,
      nameNorm: name,
    });
  }

  // If pure "budapest" search, prepend district quick-access items
  if (isPureBudapest) {
    const districtItems = BUDAPEST_DISTRICTS.map(d => ({
      type: "district",
      label: d.label,
      query: d.query,
      search: d.search,
    }));
    return res.json([...districtItems, ...results.slice(0, 20)]);
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.stopName.localeCompare(b.stopName);
  });

  const top = results.slice(0, 20).map(({ score, nameNorm, ...rest }) => rest);
  res.json(top);
});

app.post("/api/routes", (req, res) => {
  if (!graphReady) {
    return res.status(503).json({ error: "Graph not ready" });
  }

  const { fromStopId, toStopId, date, hour, minute, isArrival, maxTransfers, maxWalk, allowTransfers, wholeDay } =
    req.body;

  const h = parseInt(hour) || new Date().getHours();
  const m = parseInt(minute) || new Date().getMinutes();

  const result = findRoutes(graph, {
    fromStopId,
    toStopId,
    date,
    hour: h,
    minute: m,
    isArrival: isArrival || false,
    maxTransfers: parseInt(maxTransfers) || 5,
    maxWalk: parseInt(maxWalk) || 700,
    allowTransfers: allowTransfers !== false,
    wholeDay: wholeDay === true,
  });

  if (result.error) {
    return res.status(400).json(result);
  }

  res.json(result);
});

app.get("/api/departures", (req, res) => {
  if (!graphReady) {
    return res.status(503).json({ error: "Graph not ready" });
  }

  const { stopId, hour, minute, maxCount } = req.query;

  if (!stopId) {
    return res.status(400).json({ error: "stopId required" });
  }

  const now = new Date();
  const h = parseInt(hour) || now.getHours();
  const m = parseInt(minute) || now.getMinutes();

  const result = findDepartures(graph, stopId, h, m, parseInt(maxCount) || 20);
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
