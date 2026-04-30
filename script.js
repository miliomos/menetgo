const fromInput = document.getElementById("from-input");
const toInput = document.getElementById("to-input");
const fromDropdown = document.getElementById("from-dropdown");
const toDropdown = document.getElementById("to-dropdown");
const tripForm = document.getElementById("trip-form");
const searchButton = document.getElementById("search-button");
const resultsContainer = document.getElementById("results-container");
const resultsList = document.getElementById("results-list");
const resultsTitle = document.getElementById("results-title");
const backButton = document.getElementById("back-button");
const swapButton = document.querySelector(".swap-button");
const dateInput = document.getElementById("date-input");
const timeInput = document.getElementById("time-input");
const timeLabel = document.getElementById("time-label");
const wholeDayMode = document.getElementById("whole-day-mode");
const boardList = document.querySelector(".board-list");

const tabs = document.querySelectorAll(".tab");

let selectedFrom = null;
let selectedTo = null;
let searchTimeout = null;
let serverReady = false;
let fromJustSelected = false;
let toJustSelected = false;

const today = new Date();
dateInput.value = today.toISOString().split("T")[0];
timeInput.value =
  String(today.getHours()).padStart(2, "0") +
  ":" +
  String(today.getMinutes()).padStart(2, "0");

const DEFAULT_BOARD_STOPS = [
  { name: "Örs vezér tere", id: null, source: "bkk" },
  { name: "Déli pályaudvar", id: null, source: "bkk" },
  { name: "Nyugati pályaudvar", id: null, source: "bkk" },
  { name: "Széll Kálmán tér", id: null, source: "bkk" },
];

const STORAGE_KEY = "searchedRoutes";
const MAX_SAVED_ROUTES = 8;

function getSavedRoutes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRoute(fromName, toName, fromId, toId) {
  const routes = getSavedRoutes();
  const existing = routes.findIndex(r => r.fromName === fromName && r.toName === toName);
  if (existing !== -1) {
    routes[existing].count++;
    routes[existing].lastUsed = Date.now();
  } else {
    routes.push({ fromName, toName, fromId, toId, count: 1, lastUsed: Date.now() });
  }
  routes.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes.slice(0, MAX_SAVED_ROUTES)));
  renderPopularRoutes();
}

function renderPopularRoutes() {
  const routeList = document.querySelector(".route-list");
  if (!routeList) return;

  const routes = getSavedRoutes();
  if (routes.length === 0) {
    routeList.innerHTML = '<div class="route-empty">Még nincs keresett útvonalad. Indíts egy keresést!</div>';
    return;
  }

  routeList.innerHTML = routes.map((r) =>
    `<button class="route-card" type="button" data-from-name="${r.fromName}" data-to-name="${r.toName}" data-from-id="${r.fromId}" data-to-id="${r.toId}">
      <strong>${r.fromName} → ${r.toName}</strong>
      <span>${r.count} keresés</span>
    </button>`
  ).join("");

  routeList.querySelectorAll(".route-card").forEach((card) => {
    card.addEventListener("click", async () => {
      const fromName = card.dataset.fromName;
      const toName = card.dataset.toName;
      fromInput.value = fromName;
      toInput.value = toName;
      selectedFrom = card.dataset.fromId;
      selectedTo = card.dataset.toId;
      document.getElementById("search").scrollIntoView({ behavior: "smooth" });
    });
  });
}

async function resolveStopIdByName(name, source) {
  const searchPart = name.split(",")[0].substring(0, 30);
  try {
    const res = await fetch(`/api/stations?q=${encodeURIComponent(searchPart)}`);
    const stations = await res.json();
    const norm = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const s of stations) {
      const sNorm = s.stopName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (sNorm.startsWith(norm.substring(0, 20)) || norm.startsWith(sNorm.substring(0, 20))) {
        return s.stopId;
      }
    }
    return stations[0]?.stopId || null;
  } catch {
    return null;
  }
}

async function renderBoard() {
  if (!serverReady || !boardList) return;

  const departures = [];
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  for (const stop of DEFAULT_BOARD_STOPS) {
    let stopId = stop.id;
    if (!stopId) {
      stopId = await resolveStopIdByName(stop.name, stop.source);
      if (stopId) stop.id = stopId;
    }
    if (!stopId) continue;

    try {
      const res = await fetch(`/api/departures?stopId=${stopId}&hour=${hour}&minute=${minute}&maxCount=3`);
      const data = await res.json();
      if (data.departures) {
        for (const dep of data.departures) {
          departures.push({ ...dep, stationName: stop.name });
        }
      }
    } catch {
    }
  }

  departures.sort((a, b) => {
    const aMin = a.time.h * 60 + a.time.m;
    const bMin = b.time.h * 60 + b.time.m;
    return aMin - bMin;
  });

  if (departures.length === 0) {
    boardList.innerHTML = '<div class="board-empty">Nincs elérhető indulási adat</div>';
    return;
  }

  boardList.innerHTML = departures.map((dep) => {
    const timeStr = `${String(dep.time.h).padStart(2, "0")}:${String(dep.time.m).padStart(2, "0")}`;
    const depMin = dep.time.h * 60 + dep.time.m;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const diff = depMin - nowMin;
    const statusTag = diff <= 0 ? "Most" : diff <= 5 ? `${diff} perc` : timeStr;
    const statusClass = diff <= 0 ? "now" : diff <= 5 ? "soon" : "";

    return `<article class="board-row">
      <time>${timeStr}</time>
      <div>
        <strong>${dep.routeShortName || dep.routeLongName || "Járat"}</strong>
        <span>${dep.stationName}${dep.toStopName ? " → " + dep.toStopName : ""}</span>
      </div>
      <mark class="${statusClass}">${statusTag}</mark>
    </article>`;
  }).join("");
}

function debounce(fn, delay) {
  return (...args) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => fn(...args), delay);
  };
}

async function checkServerStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    serverReady = data.ready;
    return data.ready;
  } catch {
    serverReady = false;
    return false;
  }
}

async function fetchStations(query, dropdown, type) {
  if (!serverReady) {
    dropdown.innerHTML = '<div class="dropdown-empty"><span class="server-status">Szerver betöltés... Kérlek várj.</span></div>';
    dropdown.classList.add("visible");
    return;
  }

  if (query.length < 2) {
    dropdown.innerHTML = "";
    dropdown.classList.remove("visible");
    return;
  }

  try {
    const res = await fetch(`/api/stations?q=${encodeURIComponent(query)}&type=${type}`);
    const stations = await res.json();

    if (stations.length === 0) {
      dropdown.innerHTML = '<div class="dropdown-empty">Nincs találat</div>';
    } else {
      dropdown.innerHTML = stations
        .map((s) => {
          if (s.type === "district") {
            return `<div class="dropdown-item dropdown-district" data-query="${s.query}" data-label="${s.label}" data-search="${s.search || ""}">
              <span class="dropdown-name">${s.label}</span>
              <span class="dropdown-meta">Budapest kerületek</span>
            </div>`;
          }
          const districtText = s.district ? ` • ${s.district}` : "";
          return `<div class="dropdown-item" data-stop-id="${s.stopId}" data-name="${s.stopName}" data-source="${s.source}">
            <span class="dropdown-name">${highlightMatch(s.stopName, query)}</span>
            <span class="dropdown-meta">${s.source === "bkk" ? "BKK" : "Volánbusz"}${s.stopDesc ? " • " + s.stopDesc : ""}${districtText}</span>
          </div>`;
        })
        .join("");

      dropdown.querySelectorAll(".dropdown-item").forEach((item) => {
        if (item.classList.contains("dropdown-district")) {
          item.addEventListener("click", async () => {
            const districtLabel = item.dataset.label;
            const query = item.dataset.query || districtLabel;
            if (type === "from") {
              fromInput.value = districtLabel;
              await selectFirstDistrictStop(query, "from");
              fromDropdown.classList.remove("visible");
            } else {
              toInput.value = districtLabel;
              await selectFirstDistrictStop(query, "to");
              toDropdown.classList.remove("visible");
            }
          });
        } else {
          item.addEventListener("click", () => selectStation(item, dropdown, type));
        }
      });
    }

    dropdown.classList.add("visible");
  } catch (err) {
    console.error("Station search failed:", err);
    dropdown.innerHTML = '<div class="dropdown-empty">Hiba történt a keresés során</div>';
    dropdown.classList.add("visible");
  }
}

async function selectFirstDistrictStop(query, type) {
  try {
    const res = await fetch(`/api/stations?q=${encodeURIComponent(query)}`);
    const stations = await res.json();
    if (stations.length > 0) {
      const best = stations[0];
      if (type === "from") {
        selectedFrom = best.stopId;
      } else {
        selectedTo = best.stopId;
      }
    }
  } catch (err) {
    console.error("Failed to select district stop:", err);
  }
}

function showPopularStations(dropdown, type) {
  if (!serverReady) {
    dropdown.innerHTML = '<div class="dropdown-empty"><span class="server-status">Szerver betöltés... Kérlek várj.</span></div>';
    dropdown.classList.add("visible");
    return;
  }

  dropdown.innerHTML = "";
  dropdown.classList.remove("visible");
}

function normalizeQuery(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[,\.\-\–—\(\)\[\]\/\\'\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function highlightMatch(name, query) {
  const normName = normalizeQuery(name);
  const normQuery = normalizeQuery(query);
  const idx = normName.indexOf(normQuery);
  if (idx === -1) return name;
  return (
    name.slice(0, idx) +
    '<mark>' +
    name.slice(idx, idx + query.length) +
    '</mark>' +
    name.slice(idx + query.length)
  );
}

function selectStation(item, dropdown, type) {
  const name = item.dataset.name;
  const stopId = item.dataset.stopId;

  if (type === "from") {
    fromInput.value = name;
    selectedFrom = stopId;
    fromJustSelected = true;
  } else {
    toInput.value = name;
    selectedTo = stopId;
    toJustSelected = true;
  }

  dropdown.innerHTML = "";
  dropdown.classList.remove("visible");
}

const searchFrom = debounce((q) => fetchStations(q, fromDropdown, "from"), 300);
const searchTo = debounce((q) => fetchStations(q, toDropdown, "to"), 300);

fromInput.addEventListener("input", (e) => {
  fromJustSelected = false;
  selectedFrom = null;
  searchFrom(e.target.value);
});

fromInput.addEventListener("focus", () => {
  if (fromJustSelected) return;
  if (fromInput.value.length >= 2) {
    searchFrom(fromInput.value);
  } else {
    showPopularStations(fromDropdown, "from");
  }
});

toInput.addEventListener("input", (e) => {
  toJustSelected = false;
  selectedTo = null;
  searchTo(e.target.value);
});

toInput.addEventListener("focus", () => {
  if (toJustSelected) return;
  if (toInput.value.length >= 2) {
    searchTo(toInput.value);
  } else {
    showPopularStations(toDropdown, "to");
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".input-wrapper")) {
    fromDropdown.classList.remove("visible");
    toDropdown.classList.remove("visible");
  }
});

swapButton?.addEventListener("click", () => {
  const fromVal = fromInput.value;
  const toVal = toInput.value;
  const fromId = selectedFrom;
  const toId = selectedTo;

  fromInput.value = toVal;
  toInput.value = fromVal;
  selectedFrom = toId;
  selectedTo = fromId;
  fromJustSelected = false;
  toJustSelected = false;
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
  });
});

tripForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!serverReady) {
    alert("A szerver még betöltés alatt van. Kérlek várj egy pillanatot!");
    return;
  }

  if (!selectedFrom || !selectedTo) {
    if (!selectedFrom) {
      fromInput.parentElement.classList.add("shake");
      setTimeout(() => fromInput.parentElement.classList.remove("shake"), 600);
    }
    if (!selectedTo) {
      toInput.parentElement.classList.add("shake");
      setTimeout(() => toInput.parentElement.classList.remove("shake"), 600);
    }
    return;
  }

  const direction = document.querySelector('input[name="direction"]:checked').value;
  const allowTransfers = document.getElementById("allow-transfers").checked;
  const wholeDay = document.getElementById("whole-day-mode").checked;
  const dateVal = dateInput.value;
  const timeVal = timeInput.value;
  const [hour, minute] = timeVal.split(":").map(Number);

  setLoading(true);

  try {
    const res = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromStopId: selectedFrom,
        toStopId: selectedTo,
        date: dateVal,
        hour: wholeDay ? 0 : hour,
        minute: wholeDay ? 0 : minute,
        isArrival: direction === "arrival",
        allowTransfers,
        wholeDay,
      }),
    });

    const data = await res.json();

    if (data.error) {
      resultsList.innerHTML = `<div class="results-error">${data.error}</div>`;
    } else if (!data.results || data.results.length === 0) {
      resultsList.innerHTML =
        '<div class="no-results"><p>Nem található járat a megadott időpontban.</p><p>Próbálj más időpontot vagy állomást.</p></div>';
    } else {
      saveRoute(fromInput.value, toInput.value, selectedFrom, selectedTo);
      renderResults(data.results);
    }

    resultsContainer.style.display = "block";
    resultsContainer.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    resultsList.innerHTML =
      '<div class="results-error">Hiba történt a keresés során. Próbáld újra később.</div>';
    resultsContainer.style.display = "block";
  }

  setLoading(false);
});

backButton.addEventListener("click", () => {
  resultsContainer.style.display = "none";
  document.getElementById("search").scrollIntoView({ behavior: "smooth" });
});

wholeDayMode.addEventListener("change", () => {
  if (wholeDayMode.checked) {
    timeInput.disabled = true;
    timeInput.parentElement.classList.add("disabled");
  } else {
    timeInput.disabled = false;
    timeInput.parentElement.classList.remove("disabled");
  }
});

function setLoading(loading) {
  const text = searchButton.querySelector(".button-text");
  const loader = searchButton.querySelector(".button-loader");

  if (loading) {
    text.style.display = "none";
    loader.style.display = "inline-flex";
    searchButton.disabled = true;
  } else {
    text.style.display = "inline";
    loader.style.display = "none";
    searchButton.disabled = false;
  }
}

function renderResults(results) {
  const fromName = fromInput.value;
  const toName = toInput.value;
  resultsTitle.textContent = `${fromName} → ${toName}`;

  resultsList.innerHTML = results
    .map(
      (r) => {
        const rideSegments = r.segments.filter((s) => s.type !== "transfer");
        const transferSegments = r.segments.filter((s) => s.type === "transfer");

        let segmentsHtml = "";
        for (let i = 0; i < r.segments.length; i++) {
          const seg = r.segments[i];
          if (seg.type === "transfer") {
            const waitMin = Math.round(seg.waitTime / 60);
            segmentsHtml += `
              <div class="journey-transfer">
                <span class="transfer-icon">⬡</span>
                <span class="transfer-text">Átszállás itt: ${seg.fromStopName || ""} (${waitMin} perc várakozás)</span>
              </div>`;
          } else {
            segmentsHtml += `
              <div class="journey-segment">
                <div class="segment-header">
                  <span class="route-badge ${getRouteBadgeClass(seg.routeType)}">${seg.routeShortName || "Járat"}</span>
                  <span class="segment-name">${seg.routeLongName || ""}</span>
                </div>
                <div class="segment-stops">
                  <span class="segment-from">${seg.fromStopName || ""}</span>
                  <span class="segment-arrow">→</span>
                  <span class="segment-to">${seg.toStopName || ""}</span>
                </div>
                <div class="segment-times">
                  <span class="segment-dep">${seg.departureTime || ""}</span>
                  <span class="segment-arr">${seg.arrivalTime || ""}</span>
                </div>
              </div>`;
          }
        }

        return `
          <article class="result-card">
            <div class="result-header">
              <div class="result-time">
                <span class="result-dep">${formatTime(r.departure.time)}</span>
                <span class="result-arrow">→</span>
                <span class="result-arr">${formatTime(r.arrival.time)}</span>
              </div>
              <div class="result-meta">
                <span class="result-duration">${r.travelTimeMinutes} perc</span>
                ${r.transfers > 0 ? `<span class="result-transfers">${r.transfers} átszállás</span>` : '<span class="result-direct">Közvetlen</span>'}
              </div>
            </div>
            <div class="journey-segments">
              ${segmentsHtml}
            </div>
          </article>`;
      }
    )
    .join("");
}

function formatTimeFromString(timeStr) {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  return `${parts[0]}:${parts[1]}`;
}

function formatTime(timeObj) {
  return `${String(timeObj.h).padStart(2, "0")}:${String(timeObj.m).padStart(2, "0")}`;
}

function getRouteBadgeClass(routeType) {
  switch (String(routeType)) {
    case "2":
    case "3":
      return "badge-train";
    case "700":
    case "701":
    case "702":
      return "badge-metro";
    case "0":
    case "704":
    case "705":
    case "706":
    case "715":
    case "717":
      return "badge-bus";
    case "1":
    case "900":
      return "badge-tram";
    default:
      return "badge-default";
  }
}

checkServerStatus();
setInterval(checkServerStatus, 5000);
renderPopularRoutes();

let boardInterval = null;
async function initBoard() {
  await renderBoard();
  if (boardInterval) clearInterval(boardInterval);
  boardInterval = setInterval(renderBoard, 60000);
}

const observer = new MutationObserver(() => {
  if (serverReady) {
    initBoard();
    observer.disconnect();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

const refreshBoardLink = document.querySelector("#board .section-heading a");
if (refreshBoardLink) {
  refreshBoardLink.addEventListener("click", (e) => {
    e.preventDefault();
    renderBoard();
  });
}

const clearRoutesLink = document.querySelector("#routes .section-heading a");
if (clearRoutesLink) {
  clearRoutesLink.addEventListener("click", (e) => {
    e.preventDefault();
    localStorage.removeItem(STORAGE_KEY);
    renderPopularRoutes();
  });
}
