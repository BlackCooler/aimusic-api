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

function parseNumber(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
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

function slicePage(items, offset, limit) {
  return items.slice(offset, offset + limit);
}

function looksLikeBadArchiveItem(item) {
  const text = `${item.title} ${item.artist}`.toLowerCase();

  const badWords = [
    "podcast",
    "episode",
    "news",
    "interview",
    "audiobook",
    "sermon",
    "lecture",
    "bitcoin",
    "nft",
    "politics",
    "freakonomics",
    "talk",
    "comedy",
    "armstrong and getty",
    "mind pump",
    "terraspaces",
    "a really good cry",
    "my daughter is a communist",
    "twenty thousand hertz"
  ];

  return badWords.some(word => text.includes(word));
}

function looksLikeGoodArchiveItem(item) {
  const text = `${item.title} ${item.artist}`.toLowerCase();

  const goodWords = [
    "mix",
    "dj",
    "house",
    "techno",
    "trance",
    "edm",
    "music",
    "jazz",
    "chill",
    "ambient",
    "psychill",
    "drum",
    "bass",
    "dance",
    "remix",
    "set",
    "radio edit",
    "vol",
    "album",
    "exclusive guest mix"
  ];

  return goodWords.some(word => text.includes(word));
}

function looksLikeGoodRadio(item) {
  const text = `${item.title} ${item.artist}`.toLowerCase();

  const goodWords = [
    "music",
    "pop",
    "rock",
    "jazz",
    "dance",
    "house",
    "hits",
    "smooth jazz",
    "disney",
    "los40",
    "stereorey",
    "fonógrafo",
    "beat",
    "mix",
    "oye",
    "exa",
    "joya",
    "piano",
    "radio disney"
  ];

  const badWords = [
    "noticias",
    "news",
    "formula",
    "conversación",
    "talk",
    "traffic"
  ];

  const hasGood = goodWords.some(word => text.includes(word));
  const hasBad = badWords.some(word => text.includes(word));

  return hasGood && !hasBad;
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

async function getAudiusTrending() {
  const res = await fetch(
    "https://discoveryprovider.audius.co/v1/tracks/trending?limit=100"
  );
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

async function searchAudius(query) {
  const res = await fetch(
    `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=100`
  );
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

async function getArchiveMusic(query = "music") {
  const q =
    `(${query}) AND mediatype:audio ` +
    `AND (title:music OR title:mix OR title:dj OR title:house OR title:techno OR subject:music OR subject:mix OR subject:dj)`;

  const res = await fetch(
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=80&output=json`
  );

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
    .filter(item => !looksLikeBadArchiveItem(item))
    .filter(looksLikeGoodArchiveItem);
}

async function getRadioMusic() {
  const res = await fetch(
    "https://de1.api.radio-browser.info/json/stations/bytag/music",
    {
      headers: {
        "User-Agent": "AIMusic/1.0"
      }
    }
  );

  const json = await res.json();
  const rows = Array.isArray(json) ? json.slice(0, 100) : [];

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
    .filter(looksLikeGoodRadio);
}

async function buildTrendingPool() {
  const [audius, archive, radio] = await Promise.all([
    safeRun("audius", () => getAudiusTrending()),
    safeRun("archive", () => getArchiveMusic("music")),
    safeRun("radio", () => getRadioMusic())
  ]);

  return uniqBy(
    [...audius, ...archive, ...radio].filter(t => t.stream),
    t => `${t.title.toLowerCase()}__${t.artist.toLowerCase()}__${t.source}`
  );
}

async function buildSearchPool(query) {
  const q = query && query.trim() ? query.trim() : "music";

  const [audius, archive, radio] = await Promise.all([
    safeRun("audius", () => searchAudius(q)),
    safeRun("archive", () => getArchiveMusic(q)),
    safeRun("radio", () => getRadioMusic())
  ]);

  return uniqBy(
    [...audius, ...archive, ...radio].filter(t => t.stream),
    t => `${t.title.toLowerCase()}__${t.artist.toLowerCase()}__${t.source}`
  );
}

app.get("/", (req, res) => {
  res.send("AIMusic API working");
});

app.get("/api/trending", async (req, res) => {
  const offset = parseNumber(req.query.offset, 0);
  const limit = Math.min(parseNumber(req.query.limit, 50), 100);

  const allTracks = await buildTrendingPool();
  const tracks = slicePage(allTracks, offset, limit);

  res.json({
    total_pool: allTracks.length,
    total_returned: tracks.length,
    offset,
    limit,
    next_offset: offset + tracks.length < allTracks.length ? offset + tracks.length : null,
    sources_active: [...new Set(allTracks.map(t => t.source))],
    tracks
  });
});

app.get("/api/new", async (req, res) => {
  const offset = parseNumber(req.query.offset, 0);
  const limit = Math.min(parseNumber(req.query.limit, 50), 100);

  const allTracks = await buildSearchPool("new music");
  const tracks = slicePage(allTracks, offset, limit);

  res.json({
    total_pool: allTracks.length,
    total_returned: tracks.length,
    offset,
    limit,
    next_offset: offset + tracks.length < allTracks.length ? offset + tracks.length : null,
    sources_active: [...new Set(allTracks.map(t => t.source))],
    tracks
  });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const offset = parseNumber(req.query.offset, 0);
  const limit = Math.min(parseNumber(req.query.limit, 50), 100);

  if (!q) {
    return res.status(400).json({ error: "query q is required" });
  }

  const allTracks = await buildSearchPool(q);
  const tracks = slicePage(allTracks, offset, limit);

  res.json({
    query: q,
    total_pool: allTracks.length,
    total_returned: tracks.length,
    offset,
    limit,
    next_offset: offset + tracks.length < allTracks.length ? offset + tracks.length : null,
    sources_active: [...new Set(allTracks.map(t => t.source))],
    tracks
  });
});

app.listen(PORT, () => {
  console.log("AIMusic API started on port " + PORT);
});
