const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
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
    "news",
    "talk",
    "audiobook",
    "sermon",
    "lecture",
    "interview",
    "bitcoin",
    "nft",
    "radio show"
  ];

  return !badWords.some(word => text.includes(word));
}

function looksLikeMusicRadio(item) {
  const text = `${item.title} ${item.artist}`.toLowerCase();

  const goodWords = [
    "music",
    "pop",
    "rock",
    "jazz",
    "dance",
    "house",
    "hits",
    "fm",
    "radio disney",
    "smooth jazz",
    "fonógrafo",
    "los40",
    "stereorey"
  ];

  return goodWords.some(word => text.includes(word));
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

async function getAudius(limit = 60) {
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

async function searchAudius(q, limit = 60) {
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
  const q = `${query} AND mediatype:audio`;
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&rows=${limit}&output=json`;

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

async function getOpenverseAudio(limit = 40, query = "music") {
  const url = `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&page_size=${limit}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AIMusic/1.0" }
  });
  const json = await res.json();
  const results = Array.isArray(json.results) ? json.results : [];

  return results
    .map(t =>
      normalizeTrack({
        id: `openverse_${t.id}`,
        title: t.title || "Unknown",
        artist: t.creator || "Unknown",
        stream: t.url || "",
        cover: t.thumbnail || "",
        source: "openverse"
      })
    )
    .filter(looksLikeMusic);
}

async function getRadioMusic(limit = 40, tag = "music") {
  const url = `https://de1.api.radio-browser.info/json/stations/bytag/${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AIMusic/1.0" }
  });
  const json = await res.json();
  const rows = Array.isArray(json) ? json.slice(0, limit) : [];

  return rows
    .map(t =>
      normalizeTrack({
        id: `radio_${t.stationuuid}`,
        title: t.name || "Radio",
        artist: t.country || "Radio",
        stream: t.url_resolved || t.url || "",
        cover: t.favicon || "",
        source: "radio"
      })
    )
    .filter(looksLikeMusicRadio);
}

async function getTrendingAll() {
  const [audius, archive, openverse, radio] = await Promise.all([
    safeRun("audius", () => getAudius(60)),
    safeRun("archive", () => getArchiveMusic(35, "music")),
    safeRun("openverse", () => getOpenverseAudio(30, "music")),
    safeRun("radio", () => getRadioMusic(30, "music"))
  ]);

  return uniqBy(
    [...audius, ...archive, ...openverse, ...radio].filter(t => t.stream),
    t => `${t.title.toLowerCase()}__${t.artist.toLowerCase()}__${t.source}`
  );
}

async function searchAll(q) {
  const query = q && q.trim() ? q.trim() : "music";

  const [audius, archive, openverse, radio] = await Promise.all([
    safeRun("audius", () => searchAudius(query, 60)),
    safeRun("archive", () => getArchiveMusic(35, query)),
    safeRun("openverse", () => getOpenverseAudio(30, query)),
    safeRun("radio", () => getRadioMusic(30, query))
  ]);

  return uniqBy(
    [...audius, ...archive, ...openverse, ...radio].filter(t => t.stream),
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
    sources_active: [...new Set(tracks.map(t => t.source))],
    tracks
  });
});

app.get("/api/new", async (req, res) => {
  const tracks = await searchAll("new music");
  res.json({
    total: tracks.length,
    sources_active: [...new Set(tracks.map(t => t.source))],
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
    sources_active: [...new Set(tracks.map(t => t.source))],
    tracks
  });
});

app.listen(PORT, () => {
  console.log("AIMusic API started on port " + PORT);
});
