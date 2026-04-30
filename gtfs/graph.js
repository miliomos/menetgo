import { parseCSV } from "./loader.js";

export async function buildGraph(feedDirs) {
  console.log("Building transit graph...");

  const stopsMap = new Map();
  const stopTimesByTrip = new Map();
  const trips = new Map();
  const routes = new Map();

  for (const [key, dir] of Object.entries(feedDirs)) {
    console.log(`  Loading ${key} data...`);

    const stops = await parseCSV(dir, "stops.txt");
    const tripsData = await parseCSV(dir, "trips.txt");
    const routesData = await parseCSV(dir, "routes.txt");

    for (const r of routesData) {
      if (!routes.has(r.route_id)) {
        routes.set(r.route_id, { ...r, source: key });
      }
    }

    for (const t of tripsData) {
      trips.set(t.trip_id, { ...t, source: key });
    }

    for (const s of stops) {
      if (!stopsMap.has(s.stop_id)) {
        stopsMap.set(s.stop_id, {
          ...s,
          source: key,
          lat: parseFloat(s.stop_lat) || 0,
          lon: parseFloat(s.stop_lon) || 0,
        });
      }
    }

    console.log(`  ${key}: ${stops.length} stops, ${tripsData.length} trips`);
    console.log(`  Parsing stop_times for ${key}...`);

    await parseStopTimesStreaming(dir, trips, stopTimesByTrip);

    console.log(`  ${key}: stop_times parsed`);
  }

  for (const [tripId, times] of stopTimesByTrip) {
    if (trips.has(tripId)) {
      trips.get(tripId).stopTimes = times;
    }
  }

  const stopTimesIndex = buildStopTimesIndex(stopTimesByTrip);

  const stopTransferIndex = buildTransferIndex(stopsMap);

  console.log(
    `Graph built: ${stopsMap.size} stops, ${trips.size} trips, ${stopTimesIndex.size} indexed`
  );

  return {
    stops: stopsMap,
    stopTimesIndex,
    trips,
    routes,
    transferIndex: stopTransferIndex,
  };
}

import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { createReadStream } from "fs";

function parseStopTimesStreaming(dir, tripsMap, stopTimesByTrip) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(dir, "stop_times.txt");
    if (!fs.existsSync(filePath)) {
      resolve();
      return;
    }

    const tripIds = new Set(tripsMap.keys());
    let count = 0;

    createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => {
        if (!tripIds.has(row.trip_id)) return;

        if (!stopTimesByTrip.has(row.trip_id)) {
          stopTimesByTrip.set(row.trip_id, []);
        }

        stopTimesByTrip.get(row.trip_id).push({
          trip_id: row.trip_id,
          stop_id: row.stop_id,
          arrival_time: row.arrival_time,
          departure_time: row.departure_time,
          stop_sequence: parseInt(row.stop_sequence) || 0,
        });

        count++;
        if (count % 500000 === 0) {
          console.log(`    ...parsed ${count} stop_times`);
        }
      })
      .on("end", () => {
        console.log(`    Total stop_times loaded: ${count}`);
        resolve();
      })
      .on("error", reject);
  });
}

function buildStopTimesIndex(stopTimesByTrip) {
  const index = new Map();

  for (const [tripId, times] of stopTimesByTrip) {
    times.sort((a, b) => a.stop_sequence - b.stop_sequence);

    for (const time of times) {
      if (!index.has(time.stop_id)) {
        index.set(time.stop_id, []);
      }
      index.get(time.stop_id).push({
        trip_id: time.trip_id,
        arrival_time: time.arrival_time,
        departure_time: time.departure_time,
        stop_sequence: time.stop_sequence,
      });
    }
  }

  for (const [stopId, times] of index) {
    times.sort((a, b) => {
      const at = timeToSeconds(a.departure_time || a.arrival_time);
      const bt = timeToSeconds(b.departure_time || b.arrival_time);
      return at - bt;
    });
  }

  return index;
}

function timeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(":");
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || 0);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildTransferIndex(stopsMap, maxDist = 500) {
  const stops = Array.from(stopsMap.values());
  const index = new Map();

  const gridSize = maxDist / 111320;
  const grid = new Map();

  for (const stop of stops) {
    const gx = Math.floor(stop.lon / gridSize);
    const gy = Math.floor(stop.lat / gridSize);
    const key = `${gx},${gy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(stop);
  }

  for (const stop of stops) {
    const gx = Math.floor(stop.lon / gridSize);
    const gy = Math.floor(stop.lat / gridSize);
    const transfers = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gx + dx},${gy + dy}`;
        const cell = grid.get(key) || [];
        for (const other of cell) {
          if (other.stop_id === stop.stop_id) continue;
          const dist = haversineDistance(stop.lat, stop.lon, other.lat, other.lon);
          if (dist <= maxDist) {
            transfers.push({
              stopId: other.stop_id,
              dist: Math.round(dist),
              walkTime: Math.round(dist / 1.4),
            });
          }
        }
      }
    }

    index.set(stop.stop_id, transfers);
  }

  return index;
}
