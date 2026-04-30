import fetch from "node-fetch";
import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

const CACHE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "cache");

const FEEDS = {
  bkk: {
    name: "BKK (Budapest)",
    url: "https://go.bkk.hu/api/static/v1/public-gtfs/budapest_gtfs.zip",
    file: "bkk_gtfs.zip",
  },
  volanbusz: {
    name: "Volánbusz",
    url: "https://gtfs.kti.hu/public-gtfs/volanbusz_gtfs.zip",
    file: "volanbusz_gtfs.zip",
  },
};

export async function downloadFeed(key) {
  const feed = FEEDS[key];
  if (!feed) throw new Error(`Unknown feed: ${key}`);

  const zipPath = path.join(CACHE_DIR, feed.file);
  const extractDir = path.join(CACHE_DIR, key);

  if (fs.existsSync(extractDir)) {
    console.log(`  ${feed.name}: already extracted, skipping download`);
    return extractDir;
  }

  console.log(`  Downloading ${feed.name}...`);
  const res = await fetch(feed.url);
  if (!res.ok) throw new Error(`Failed to download ${feed.name}: ${res.status}`);

  const writeStream = createWriteStream(zipPath);
  await pipeline(res.body, writeStream);

  console.log(`  Extracting ${feed.name}...`);
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);

  console.log(`  ${feed.name}: ready`);
  return extractDir;
}

export async function downloadAllFeeds() {
  const dirs = {};
  for (const key of Object.keys(FEEDS)) {
    dirs[key] = await downloadFeed(key);
  }
  return dirs;
}

export function parseCSV(dir, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) {
      resolve([]);
      return;
    }
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (row) => results.push(row))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}
