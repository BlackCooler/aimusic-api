const express = require("express");
const fetch = require("node-fetch");

const app = express();

const PORT = process.env.PORT || 3000;
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || "";
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || "";

function uniqBy(list, keyFn) {
  const seen = new Set();
  const out = [];

  for (const item of list) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function normalizeTrack(track) {
  return {
    id: String(track.id || ""),
    title: String(track.title || "Unknown"),
    artist: String(track.artist || "Unknown"),
    stream: String(track.stream || ""),
    cover: String(track.cover || ""),
    source: String(track.source || "unknown")
  };
}

function looksLikeMusic(item) {
  const text = `${item.title} ${item.artist}`.toLowerCase();

  const badWords = [
    "podcast",
    "episode",
    "sermon",
    "news",
    "talk",
    "radio show",
    "audiobook",
    "lecture",
    "homily"
  ];

  return !badWords.some(word => text.includes(word));
}

async function safeRun(label, fn) {
  try {
    const result = await fn();
    return Array.isArray(result) ? result : [];
  } catch (e) {
    console.log(`${label} error:`, e.message);
    return [];
  }
}

async function getAudiusTrending(limit = 50) {
  const url = `https://discoveryprovider.audius.co/v1/tracks/trending?limit=${limit}`;
  const res = await fetch(url);
  const json = await res.json();

  const data = Array.isArray(json.data) ? json.data : [];

  return data.map(t =>
    normalizeTrack({
      id: `audius_${t.id}`,
      title: t.title,
      artist: t.user?.name || "Unknown",
      stream: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
      cover: t.artwork?.["480x480"] || "",
      source: "audius"
    })
  );
}

async function searchAudius(q, limit = 50) {
  const url = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url);
  const json = await res.json();

  const data = Array.isArray(json.data) ? json.data : [];

  return data.map(t =>
    normalizeTrack({
      id: `audius_${t.id}`,
      title: t.title,
      artist: t.user?.name || "Unknown",
      stream: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
      cover: t.artwork?.["480x480"] || "",
      source: "audius"
    })
  );
}

async function getArchiveMusic(limit = 50, query = "music") {
  const search = `${query} AND mediatype:audio`;
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(search)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=subject&rows=${limit}&output=json`;

  const res = await fetch(url);
  const json = await res.json();
  const docs = json?.response?.docs || [];

  return docs
    .map(t =>
      normalizeTrack({
        id: `archive_${t.identifier}`,
        title: t.title || "Unknown",
        artist: Array.isArray(t.creator) ? t.creator[0] : (t.creator || "Unknown"),
        stream: `https://archive.org/download/${t.identifier}`,
        cover: "",
        source: "archive"
      })
    )
    .filter(looksLikeMusic);
}

async function getOpenverseAudio(limit = 50, query = "music") {
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&page_size=${limit}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "AIMusic/1.0"
    }
  });
  const json = await res.json();
  const results = Array.isArray(json.results) ? json.results : [];

  return results.map(t =>
    normalizeTrack({
      id: `openverse_${t.id}`,
      title: t.title || t.foreign_landing_url || "Unknown",
      artist: t.creator || "Unknown",
      stream: t.url || "",
      cover: t.thumbnail || "",
      source: "openverse"
    })
  );
}

async function getRadioMusic(limit = 50, tag = "music") {
  const url = `https://de1.api.radio-browser.info/json/stations/bytag/${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "AIMusic/1.0"
    }
  });
  const json = await res.json();
  const rows = Array.isArray(json) ? json.slice(0, limit) : [];

  return rows.map(t =>
    normalizeTrack({
      id: `radio_${t.stationuuid}`,
      title: t.name || "Radio station",
      artist: t.country || t.state || "Radio",
      stream: t.url_resolved || t.url || "",
      cover: t.favicon || "",
      source: "radio"
    })
  );
}

async function getJamendo(limit = 50, query = "") {
  if (!JAMENDO_CLIENT_ID) return [];

  const base = "https://api.jamendo.com/v3.0/tracks/";
  const params = new URLSearchParams({
    client_id: JAMENDO_CLIENT_ID,
    limit: String(limit),
    format: "json",
    include: "musicinfo"
  });

  if (query) {
    params.set("search", query);
  }

  const res = await fetch(`${base}?${params.toString()}`);
  const json = await res.json();
  const results = Array.isArray(json.results) ? json.results : [];

  return results.map(t =>
    normalizeTrack({
      id: `jamendo_${t.id}`,
      title: t.name || "Unknown",
      artist: t.artist_name || "Unknown",
      stream: t.audio || "",
      cover: t.album_image || "",
      source: "jamendo"
    })
  );
}

async function getPixabayMusic(limit = 50, query = "music") {
  if (!PIXABAY_API_KEY) return [];

  const url =
    `https://pixabay.com/api/music/?key=${encodeURIComponent(PIXABAY_API_KEY)}` +
    `&q=${encodeURIComponent(query)}&per_page=${limit}`;

  const res = await fetch(url);
  const json = await res.json();
  const hits = Array.isArray(json.hits) ? json.hits : [];

  return hits.map(t =>
    normalizeTrack({
      id: `pixabay_${t.id}`,
      title: t.tags || "Pixabay Track",
      artist: t.user || "Pixabay",
      stream: t.audio || "",
      cover: "",
      source: "pixabay"
    })
  );
}

async function getTrendingAll() {
  const [audius, archive, openverse, radio, jamendo, pixabay] = await Promise.all([
    safeRun("audius", () => getAudiusTrending(60)),
    safeRun("archive", () => getArchiveMusic(40, "music")),
    safeRun("openverse", () => getOpenverseAudio(40, "music")),
    safeRun("radio", () => getRadioMusic(40, "music")),
    safeRun("jamendo", () => getJamendo(40)),
    safeRun("pixabay", () => getPixabayMusic(40, "music"))
  ]);

  return uniqBy(
    [...audius, ...archive, ...openverse, ...radio, ...jamendo, ...pixabay]
      .filter(t => t.stream),
    t => `${t.title.toLowerCase()}__${t.artist.toLowerCase()}__${t.source}`
  );
}

async function searchAll(q) {
  const query = q && q.trim() ? q.trim() : "music";

  const [audius, archive, openverse, radio, jamendo, pixabay] = await Promise.all([
    safeRun("audius", () => searchAudius(query, 50)),
    safeRun("archive", () => getArchiveMusic(30, query)),
    safeRun("openverse", () => getOpenverseAudio(30, query)),
    safeRun("radio", () => getRadioMusic(30, query)),
    safeRun("jamendo", () => getJamendo(30, query)),
    safeRun("pixabay", () => getPixabayMusic(30, query))
  ]);

  return uniqBy(
    [...audius, ...archive, ...openverse, ...radio, ...jamendo, ...pixabay]
      .filter(t => t.stream),
    t => `${t.title.toLowerCase()}__${t.artist.toLowerCase()}__${t.source}`
  );
}

app.get("/", (req, res) => {
  res.send("AIMusic API working");
});

app.get("/api/trending", async (req, res) => {
  const tracks = await getTrendingAll();
  res.json({
    total: tracks.length,
    sources_active: uniqBy(tracks.map(t => ({ source: t.source })), x => x.source).map(x => x.source),
    tracks
  });
});

app.get("/api/new", async (req, res) => {
  const tracks = await searchAll("new music");
  res.json({
    total: tracks.length,
    tracks
  });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(400).json({ error: "query q is required" });
  }

  const tracks = await searchAll(q);
  res.json({
    query: q,
    total: tracks.length,
    tracks
  });
});

app.listen(PORT, () => {
  console.log("AIMusic API started on port " + PORT);
});
