// server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || "";
const DB_SSL = String(process.env.DB_SSL || "false").toLowerCase() === "true";
const AUTO_BOOTSTRAP =
  String(process.env.AUTO_BOOTSTRAP || "true").toLowerCase() === "true";

const http = axios.create({
  timeout: 25000,
  headers: {
    "User-Agent": "AIMusic/1.0",
    Accept: "application/json, text/plain, */*",
  },
});

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DB_SSL ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
    })
  : null;

const AUDIOUS_BASE = "https://discoveryprovider.audius.co/v1";
const RADIO_BROWSER_BASE = "https://de1.api.radio-browser.info/json";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const AUDIOUS_SEEDS = [
  "house",
  "techno",
  "tech house",
  "deep house",
  "progressive house",
  "melodic techno",
  "drum and bass",
  "dubstep",
  "bass music",
  "phonk",
  "trap",
  "hip hop",
  "rap",
  "pop",
  "dance",
  "edm",
  "electronic",
  "ambient",
  "lofi",
  "chillhop",
  "synthwave",
  "vaporwave",
  "garage",
  "uk garage",
  "breakbeat",
  "trance",
  "psytrance",
  "hardstyle",
  "hard techno",
  "disco",
  "afro house",
  "latin",
  "reggaeton",
  "indie",
  "rock",
  "metal",
  "jazz",
  "soul",
  "funk",
  "experimental",
  "wave",
  "club",
  "remix",
  "edit",
  "electro",
  "minimal",
  "future bass",
  "dnb",
  "riddim",
  "chill",
  "night drive",
  "party",
  "club music",
  "dance remix",
  "underground",
  "festival",
];

const ARCHIVE_SEEDS = [
  "house mix",
  "techno mix",
  "deep house mix",
  "melodic techno",
  "drum and bass mix",
  "dubstep mix",
  "electronic mix",
  "dj mix",
  "club mix",
  "trance mix",
  "progressive house mix",
  "minimal techno",
  "afro house mix",
  "latin house",
  "disco mix",
  "funk mix",
  "soul mix",
  "jazz mix",
  "ambient mix",
  "lofi mix",
  "chillhop mix",
  "breakbeat mix",
  "garage mix",
  "uk garage mix",
  "hard techno mix",
  "psytrance mix",
  "radio show dance",
  "live set house",
  "live set techno",
  "music podcast mix",
  "electro house",
  "edm mix",
  "nightclub mix",
  "festival set",
  "tech house live",
  "progressive trance",
  "deep mix",
  "dj set",
  "house classics",
  "dancefloor mix",
];

const RADIO_TAGS = [
  "pop",
  "rock",
  "dance",
  "electronic",
  "house",
  "techno",
  "trance",
  "jazz",
  "smooth jazz",
  "hiphop",
  "rap",
  "reggaeton",
  "latin",
  "disco",
  "funk",
  "80s",
  "90s",
  "hits",
  "club",
  "edm",
  "ambient",
  "lounge",
  "chillout",
  "lofi",
  "indie",
];

function nowIso() {
  return new Date().toISOString();
}

function log(...args) {
  console.log(`[${nowIso()}]`, ...args);
}

function parseNumber(value, fallback, min, max) {
  let n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) n = fallback;
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHttpUrl(value) {
  const url = cleanText(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeUrl(value) {
  return isHttpUrl(value) ? cleanText(value) : "";
}

function normalizeSourceList(value) {
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function uniqBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function extractArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.response?.docs)) return payload.response.docs;
  return [];
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await mapper(items[current], current);
      } catch (error) {
        results[current] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, concurrency) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

async function safeGet(url, config = {}) {
  try {
    const response = await http.get(url, config);
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const msg = error?.response?.data || error?.message || "request failed";
    log("GET failed:", url, status || "", typeof msg === "string" ? msg : "");
    return null;
  }
}

function toTrackRow(input) {
  const source = cleanText(input.source).toLowerCase();
  const externalId = cleanText(input.external_id);
  const title = cleanText(input.title);
  const artist = cleanText(input.artist);
  const streamUrl = safeUrl(input.stream_url);
  if (!source || !externalId || !title || !streamUrl) return null;

  return {
    source,
    external_id: externalId,
    title,
    artist: artist || "Unknown",
    album: cleanText(input.album),
    stream_url: streamUrl,
    cover_url: safeUrl(input.cover_url),
    page_url: safeUrl(input.page_url),
    source_meta: input.source_meta || {},
    is_live: !!input.is_live,
    language: cleanText(input.language),
    genre: cleanText(input.genre),
    popularity_score: Number.isFinite(Number(input.popularity_score))
      ? Math.max(0, Number(input.popularity_score))
      : 0,
    published_at: input.published_at || null,
  };
}

function apiTrack(row) {
  return {
    id: `${row.source}_${row.external_id}`,
    title: row.title,
    artist: row.artist,
    album: row.album || "",
    stream: row.stream_url,
    cover: row.cover_url || "",
    page_url: row.page_url || "",
    source: row.source,
    is_live: row.is_live,
    genre: row.genre || "",
    language: row.language || "",
  };
}

async function dbQuery(sql, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is missing");
  }
  return pool.query(sql, params);
}

async function ensureDb() {
  if (!pool) {
    throw new Error("DATABASE_URL is missing");
  }

  try {
    await dbQuery(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  } catch (error) {
    log("pg_trgm skipped:", error.message);
  }

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS tracks (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      stream_url TEXT NOT NULL,
      cover_url TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL DEFAULT '',
      source_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_live BOOLEAN NOT NULL DEFAULT false,
      language TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      popularity_score INTEGER NOT NULL DEFAULT 0,
      published_at TIMESTAMPTZ NULL,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT tracks_source_external_unique UNIQUE(source, external_id)
    )
  `);

  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source)`
  );
  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_tracks_inserted_at ON tracks(inserted_at DESC)`
  );
  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_tracks_popularity ON tracks(popularity_score DESC, inserted_at DESC)`
  );
  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_tracks_title_lower ON tracks(LOWER(title))`
  );
  await dbQuery(
    `CREATE INDEX IF NOT EXISTS idx_tracks_artist_lower ON tracks(LOWER(artist))`
  );

  try {
    await dbQuery(
      `CREATE INDEX IF NOT EXISTS idx_tracks_title_trgm ON tracks USING gin (title gin_trgm_ops)`
    );
    await dbQuery(
      `CREATE INDEX IF NOT EXISTS idx_tracks_artist_trgm ON tracks USING gin (artist gin_trgm_ops)`
    );
  } catch (error) {
    log("trgm indexes skipped:", error.message);
  }
}

async function countTracks() {
  const result = await dbQuery(`SELECT COUNT(*)::int AS total FROM tracks`);
  return result.rows[0]?.total || 0;
}

async function getStats() {
  const totalResult = await dbQuery(
    `SELECT COUNT(*)::int AS total FROM tracks`
  );
  const sourceResult = await dbQuery(`
    SELECT source, COUNT(*)::int AS count
    FROM tracks
    GROUP BY source
    ORDER BY count DESC, source ASC
  `);

  return {
    total_tracks: totalResult.rows[0]?.total || 0,
    by_source: sourceResult.rows,
    sources_active: sourceResult.rows.map((row) => row.source),
  };
}

async function upsertTracks(items) {
  const rows = uniqBy(
    items.map(toTrackRow).filter(Boolean),
    (item) => `${item.source}::${item.external_id}`
  );

  if (!rows.length) {
    return { received: 0, affected: 0 };
  }

  const columns = [
    "source",
    "external_id",
    "title",
    "artist",
    "album",
    "stream_url",
    "cover_url",
    "page_url",
    "source_meta",
    "is_live",
    "language",
    "genre",
    "popularity_score",
    "published_at",
  ];

  let affected = 0;

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const values = [];
    const placeholders = [];

    chunk.forEach((row, rowIndex) => {
      const base = rowIndex * columns.length;
      placeholders.push(
        `(${columns.map((_, colIndex) => `$${base + colIndex + 1}`).join(", ")})`
      );

      values.push(
        row.source,
        row.external_id,
        row.title,
        row.artist,
        row.album,
        row.stream_url,
        row.cover_url,
        row.page_url,
        JSON.stringify(row.source_meta || {}),
        row.is_live,
        row.language,
        row.genre,
        Math.floor(row.popularity_score || 0),
        row.published_at
      );
    });

    const sql = `
      INSERT INTO tracks (
        ${columns.join(", ")}
      )
      VALUES
        ${placeholders.join(",\n")}
      ON CONFLICT (source, external_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        album = EXCLUDED.album,
        stream_url = EXCLUDED.stream_url,
        cover_url = EXCLUDED.cover_url,
        page_url = EXCLUDED.page_url,
        source_meta = EXCLUDED.source_meta,
        is_live = EXCLUDED.is_live,
        language = EXCLUDED.language,
        genre = EXCLUDED.genre,
        popularity_score = GREATEST(tracks.popularity_score, EXCLUDED.popularity_score),
        published_at = COALESCE(EXCLUDED.published_at, tracks.published_at),
        updated_at = now()
      RETURNING id
    `;

    const result = await dbQuery(sql, values);
    affected += result.rowCount || 0;
  }

  return {
    received: rows.length,
    affected,
  };
}

function normalizeAudiusTrack(track) {
  const id = cleanText(track?.id);
  if (!id) return null;

  const artwork =
    track?.artwork?.["480x480"] ||
    track?.artwork?.["1000x1000"] ||
    track?.artwork?.["150x150"] ||
    track?.cover_art ||
    "";

  return {
    source: "audius",
    external_id: id,
    title: cleanText(track?.title),
    artist: cleanText(
      track?.user?.name || track?.user?.handle || track?.artist || "Unknown"
    ),
    album: cleanText(track?.album),
    stream_url: `${AUDIOUS_BASE}/tracks/${encodeURIComponent(id)}/stream`,
    cover_url: safeUrl(artwork),
    page_url: safeUrl(track?.permalink),
    source_meta: track,
    is_live: false,
    language: cleanText(track?.language),
    genre: cleanText(track?.genre),
    popularity_score:
      Number(track?.play_count || 0) +
      Number(track?.favorite_count || 0) +
      Number(track?.repost_count || 0),
    published_at: track?.release_date || track?.created_at || null,
  };
}

async function fetchAudiusTrending({ pages = 2, limit = 100 }) {
  const tracks = [];

  for (let page = 0; page < pages; page++) {
    const payload = await safeGet(`${AUDIOUS_BASE}/tracks/trending`, {
      params: {
        offset: page * limit,
        limit,
      },
    });

    const list = extractArray(payload);
    tracks.push(...list.map(normalizeAudiusTrack).filter(Boolean));
  }

  return tracks;
}

async function fetchAudiusSearch(term, limit = 50) {
  const payload = await safeGet(`${AUDIOUS_BASE}/tracks/search`, {
    params: {
      query: term,
      limit,
      offset: 0,
    },
  });

  return extractArray(payload)
    .map(normalizeAudiusTrack)
    .filter(Boolean);
}

async function importAudius(options = {}) {
  const pages = parseNumber(options.pages, 2, 1, 10);
  const trendingLimit = parseNumber(options.trendingLimit, 100, 10, 100);
  const searchLimit = parseNumber(options.searchLimit, 50, 10, 100);

  const queryTerms =
    Array.isArray(options.terms) && options.terms.length
      ? options.terms
      : AUDIOUS_SEEDS.slice(
          parseNumber(options.seedOffset, 0, 0, AUDIOUS_SEEDS.length),
          parseNumber(options.seedOffset, 0, 0, AUDIOUS_SEEDS.length) +
            parseNumber(options.seedCount, 15, 1, AUDIOUS_SEEDS.length)
        );

  const collected = [];

  const trending = await fetchAudiusTrending({
    pages,
    limit: trendingLimit,
  });
  collected.push(...trending);

  const searchResults = await mapLimit(queryTerms, 4, async (term) =>
    fetchAudiusSearch(term, searchLimit)
  );

  for (const list of searchResults) {
    if (Array.isArray(list)) {
      collected.push(...list);
    }
  }

  const result = await upsertTracks(collected);

  return {
    source: "audius",
    terms_used: queryTerms,
    imported: result,
  };
}

function buildArchiveSearchUrl(term, page, rows) {
  const params = new URLSearchParams();
  params.append("q", `mediatype:(audio) AND (${term})`);
  params.append("rows", String(rows));
  params.append("page", String(page));
  params.append("output", "json");
  params.append("sort[]", "downloads desc");
  [
    "identifier",
    "title",
    "creator",
    "date",
    "downloads",
    "mediatype",
  ].forEach((field) => params.append("fl[]", field));

  return `https://archive.org/advancedsearch.php?${params.toString()}`;
}

async function searchArchive(term, page, rows) {
  const payload = await safeGet(buildArchiveSearchUrl(term, page, rows));
  return extractArray(payload);
}

function buildArchiveFileUrl(identifier, filename) {
  const encodedName = String(filename)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `https://archive.org/download/${encodeURIComponent(
    identifier
  )}/${encodedName}`;
}

function pickArchiveAudioFile(files) {
  if (!Array.isArray(files) || !files.length) return null;

  const allowed = files.filter((file) => {
    const name = cleanText(file?.name).toLowerCase();
    const format = cleanText(file?.format).toLowerCase();

    return (
      name.endsWith(".mp3") ||
      name.endsWith(".m4a") ||
      name.endsWith(".ogg") ||
      name.endsWith(".opus") ||
      format.includes("vbr mp3") ||
      format.includes("mp3") ||
      format.includes("ogg") ||
      format.includes("opus") ||
      format.includes("m4a")
    );
  });

  if (!allowed.length) return null;

  const scored = allowed
    .map((file) => {
      const name = cleanText(file?.name).toLowerCase();
      let score = 0;

      if (name.endsWith(".mp3")) score += 50;
      if (name.endsWith(".m4a")) score += 45;
      if (name.endsWith(".ogg")) score += 40;
      if (name.endsWith(".opus")) score += 35;
      if (!name.includes("_64kb")) score += 5;
      if (!name.includes("thumb")) score += 5;

      return { file, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.file || null;
}

async function fetchArchiveMetadata(identifier) {
  return safeGet(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
}

function normalizeArchiveTrack(doc, metadata, file) {
  const identifier = cleanText(doc?.identifier);
  const title = cleanText(doc?.title || metadata?.metadata?.title);
  const artist = cleanText(doc?.creator || metadata?.metadata?.creator);

  if (!identifier || !title || !file?.name) return null;

  return {
    source: "archive",
    external_id: identifier,
    title,
    artist: artist || "Internet Archive",
    album: cleanText(metadata?.metadata?.collection),
    stream_url: buildArchiveFileUrl(identifier, file.name),
    cover_url: "",
    page_url: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    source_meta: {
      doc,
      file,
      metadata: metadata?.metadata || {},
    },
    is_live: false,
    language: cleanText(metadata?.metadata?.language),
    genre: cleanText(metadata?.metadata?.subject || metadata?.metadata?.genre),
    popularity_score: Number(doc?.downloads || 0),
    published_at: doc?.date || metadata?.metadata?.date || null,
  };
}

async function importArchive(options = {}) {
  const rows = parseNumber(options.rows, 8, 1, 50);
  const pages = parseNumber(options.pages, 1, 1, 10);

  const terms =
    Array.isArray(options.terms) && options.terms.length
      ? options.terms
      : ARCHIVE_SEEDS.slice(
          parseNumber(options.seedOffset, 0, 0, ARCHIVE_SEEDS.length),
          parseNumber(options.seedOffset, 0, 0, ARCHIVE_SEEDS.length) +
            parseNumber(options.seedCount, 10, 1, ARCHIVE_SEEDS.length)
        );

  const docs = [];
  for (const term of terms) {
    for (let page = 1; page <= pages; page++) {
      const result = await searchArchive(term, page, rows);
      docs.push(...result);
    }
  }

  const uniqueDocs = uniqBy(
    docs.filter((doc) => cleanText(doc?.identifier)),
    (doc) => cleanText(doc.identifier)
  );

  const normalized = await mapLimit(uniqueDocs, 4, async (doc) => {
    const metadata = await fetchArchiveMetadata(doc.identifier);
    const file = pickArchiveAudioFile(metadata?.files || []);
    if (!file) return null;
    return normalizeArchiveTrack(doc, metadata, file);
  });

  const result = await upsertTracks(normalized.filter(Boolean));

  return {
    source: "archive",
    terms_used: terms,
    imported: result,
  };
}

async function fetchRadioStationsByTag(tag, limit = 40) {
  const payload = await safeGet(`${RADIO_BROWSER_BASE}/stations/search`, {
    params: {
      hidebroken: true,
      limit,
      offset: 0,
      order: "votes",
      reverse: true,
      tagList: tag,
    },
  });

  return Array.isArray(payload) ? payload : [];
}

function normalizeRadioStation(station) {
  const stationId = cleanText(station?.stationuuid);
  const name = cleanText(station?.name);
  const stream = safeUrl(station?.url_resolved || station?.url);

  if (!stationId || !name || !stream) return null;

  return {
    source: "radio",
    external_id: stationId,
    title: name,
    artist: cleanText(station?.country || station?.language || "Live Radio"),
    album: "",
    stream_url: stream,
    cover_url: safeUrl(station?.favicon),
    page_url: safeUrl(station?.homepage),
    source_meta: station,
    is_live: true,
    language: cleanText(station?.language),
    genre: cleanText(station?.tags),
    popularity_score: Number(station?.votes || 0),
    published_at: null,
  };
}

async function importRadio(options = {}) {
  const limitPerTag = parseNumber(options.limitPerTag, 30, 5, 100);

  const tags =
    Array.isArray(options.tags) && options.tags.length
      ? options.tags
      : RADIO_TAGS.slice(
          parseNumber(options.seedOffset, 0, 0, RADIO_TAGS.length),
          parseNumber(options.seedOffset, 0, 0, RADIO_TAGS.length) +
            parseNumber(options.seedCount, 10, 1, RADIO_TAGS.length)
        );

  const lists = await mapLimit(tags, 4, async (tag) =>
    fetchRadioStationsByTag(tag, limitPerTag)
  );

  const collected = [];
  for (const list of lists) {
    if (Array.isArray(list)) {
      collected.push(...list.map(normalizeRadioStation).filter(Boolean));
    }
  }

  const result = await upsertTracks(collected);

  return {
    source: "radio",
    tags_used: tags,
    imported: result,
  };
}

async function maybeBootstrap() {
  if (!AUTO_BOOTSTRAP) return;

  try {
    const total = await countTracks();
    if (total >= 150) return;

    log("bootstrap import started");

    await Promise.allSettled([
      importAudius({
        pages: 1,
        trendingLimit: 50,
        searchLimit: 30,
        seedCount: 8,
      }),
      importArchive({
        rows: 5,
        pages: 1,
        seedCount: 6,
      }),
      importRadio({
        limitPerTag: 20,
        seedCount: 6,
      }),
    ]);

    const stats = await getStats();
    log("bootstrap import finished", stats);
  } catch (error) {
    log("bootstrap import failed:", error.message);
  }
}

function buildSourceWhereClause(sources, params) {
  const normalized = sources.filter(Boolean);
  if (!normalized.length) {
    return "";
  }
  params.push(normalized);
  return `WHERE source = ANY($${params.length})`;
}

async function listTracks({ sort = "trending", offset = 0, limit = 50, sources = [] }) {
  const params = [];
  const whereSql = buildSourceWhereClause(sources, params);

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM tracks
    ${whereSql}
  `;
  const countResult = await dbQuery(countSql, params);
  const totalPool = countResult.rows[0]?.total || 0;

  params.push(limit);
  params.push(offset);

  const orderSql =
    sort === "new"
      ? `ORDER BY inserted_at DESC, popularity_score DESC`
      : `ORDER BY popularity_score DESC, inserted_at DESC`;

  const rowsSql = `
    SELECT
      source,
      external_id,
      title,
      artist,
      album,
      stream_url,
      cover_url,
      page_url,
      is_live,
      genre,
      language
    FROM tracks
    ${whereSql}
    ${orderSql}
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const rowsResult = await dbQuery(rowsSql, params);
  const stats = await getStats();

  return {
    total_pool: totalPool,
    total_returned: rowsResult.rows.length,
    offset,
    limit,
    next_offset: offset + rowsResult.rows.length,
    sources_active: stats.sources_active,
    tracks: rowsResult.rows.map(apiTrack),
  };
}

async function searchTracks({ q = "", offset = 0, limit = 50, sources = [] }) {
  const query = cleanText(q).toLowerCase();

  if (!query) {
    return listTracks({ sort: "trending", offset, limit, sources });
  }

  const baseParams = [];
  const where = [];

  if (sources.length) {
    baseParams.push(sources);
    where.push(`source = ANY($${baseParams.length})`);
  }

  baseParams.push(`%${query}%`);
  const likeParam = `$${baseParams.length}`;

  where.push(`
    (
      LOWER(title) LIKE ${likeParam}
      OR LOWER(artist) LIKE ${likeParam}
      OR LOWER(album) LIKE ${likeParam}
      OR LOWER(genre) LIKE ${likeParam}
    )
  `);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM tracks
    ${whereSql}
  `;
  const countResult = await dbQuery(countSql, baseParams);
  const totalPool = countResult.rows[0]?.total || 0;

  const dataParams = [...baseParams, query, limit, offset];
  const exactParam = `$${baseParams.length + 1}`;
  const limitParam = `$${baseParams.length + 2}`;
  const offsetParam = `$${baseParams.length + 3}`;

  const rowsSql = `
    SELECT
      source,
      external_id,
      title,
      artist,
      album,
      stream_url,
      cover_url,
      page_url,
      is_live,
      genre,
      language,
      popularity_score,
      inserted_at
    FROM tracks
    ${whereSql}
    ORDER BY
      CASE
        WHEN LOWER(title) = ${exactParam} THEN 0
        WHEN LOWER(artist) = ${exactParam} THEN 1
        WHEN LOWER(title) LIKE ${exactParam} || '%' THEN 2
        WHEN LOWER(artist) LIKE ${exactParam} || '%' THEN 3
        WHEN LOWER(album) LIKE ${exactParam} || '%' THEN 4
        ELSE 5
      END ASC,
      popularity_score DESC,
      inserted_at DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
  `;

  const rowsResult = await dbQuery(rowsSql, dataParams);
  const stats = await getStats();

  return {
    total_pool: totalPool,
    total_returned: rowsResult.rows.length,
    offset,
    limit,
    next_offset: offset + rowsResult.rows.length,
    sources_active: stats.sources_active,
    tracks: rowsResult.rows.map(apiTrack),
  };
}

app.get("/", async (req, res) => {
  try {
    const stats = pool ? await getStats() : { total_tracks: 0, by_source: [] };

    res.json({
      ok: true,
      app: "AIMusic API",
      database: !!pool,
      total_tracks: stats.total_tracks || 0,
      by_source: stats.by_source || [],
      endpoints: {
        health: "/api/health",
        stats: "/api/stats",
        trending: "/api/trending?offset=0&limit=50",
        new: "/api/new?offset=0&limit=50",
        search: "/api/search?q=house&offset=0&limit=50",
        import_all: "/api/import/all",
        import_audius: "/api/import/audius",
        import_archive: "/api/import/archive",
        import_radio: "/api/import/radio",
      },
    });
  } catch (error) {
    res.status(500).json({ error: "server error", message: error.message });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const stats = await getStats();
    res.json({
      ok: true,
      database: true,
      total_tracks: stats.total_tracks,
      sources_active: stats.sources_active,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "database error",
      message: error.message,
    });
  }
});

app.get("/api/stats", async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      error: "stats error",
      message: error.message,
    });
  }
});

app.get("/api/trending", async (req, res) => {
  try {
    const offset = parseNumber(req.query.offset, 0, 0, 100000000);
    const limit = parseNumber(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const sources = normalizeSourceList(req.query.source);

    const data = await listTracks({
      sort: "trending",
      offset,
      limit,
      sources,
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "trending error",
      message: error.message,
    });
  }
});

app.get("/api/new", async (req, res) => {
  try {
    const offset = parseNumber(req.query.offset, 0, 0, 100000000);
    const limit = parseNumber(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const sources = normalizeSourceList(req.query.source);

    const data = await listTracks({
      sort: "new",
      offset,
      limit,
      sources,
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "new error",
      message: error.message,
    });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const q = cleanText(req.query.q);
    const offset = parseNumber(req.query.offset, 0, 0, 100000000);
    const limit = parseNumber(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const sources = normalizeSourceList(req.query.source);

    const data = await searchTracks({
      q,
      offset,
      limit,
      sources,
    });

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: "search error",
      message: error.message,
    });
  }
});

app.get("/api/import/audius", async (req, res) => {
  try {
    const terms = cleanText(req.query.q)
      ? cleanText(req.query.q)
          .split(",")
          .map((v) => cleanText(v))
          .filter(Boolean)
      : [];

    const result = await importAudius({
      pages: req.query.pages,
      trendingLimit: req.query.trendingLimit,
      searchLimit: req.query.searchLimit,
      seedCount: req.query.seedCount,
      seedOffset: req.query.seedOffset,
      terms,
    });

    const stats = await getStats();

    res.json({
      ok: true,
      result,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      error: "audius import error",
      message: error.message,
    });
  }
});

app.get("/api/import/archive", async (req, res) => {
  try {
    const terms = cleanText(req.query.q)
      ? cleanText(req.query.q)
          .split(",")
          .map((v) => cleanText(v))
          .filter(Boolean)
      : [];

    const result = await importArchive({
      rows: req.query.rows,
      pages: req.query.pages,
      seedCount: req.query.seedCount,
      seedOffset: req.query.seedOffset,
      terms,
    });

    const stats = await getStats();

    res.json({
      ok: true,
      result,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      error: "archive import error",
      message: error.message,
    });
  }
});

app.get("/api/import/radio", async (req, res) => {
  try {
    const tags = cleanText(req.query.tags)
      ? cleanText(req.query.tags)
          .split(",")
          .map((v) => cleanText(v))
          .filter(Boolean)
      : [];

    const result = await importRadio({
      limitPerTag: req.query.limitPerTag,
      seedCount: req.query.seedCount,
      seedOffset: req.query.seedOffset,
      tags,
    });

    const stats = await getStats();

    res.json({
      ok: true,
      result,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      error: "radio import error",
      message: error.message,
    });
  }
});

app.get("/api/import/all", async (req, res) => {
  try {
    const audiusTerms = cleanText(req.query.audius_q)
      ? cleanText(req.query.audius_q)
          .split(",")
          .map((v) => cleanText(v))
          .filter(Boolean)
      : [];

    const archiveTerms = cleanText(req.query.archive_q)
      ? cleanText(req.query.archive_q)
          .split(",")
          .map((v) => cleanText(v))
          .filter(Boolean)
      : [];

    const radioTags = cleanText(req.query.radio_tags)
      ? cleanText(req.query.radio_tags)
          .split(",")
          .map((v) => cleanText(v))
          .filter(Boolean)
      : [];

    const [audius, archive, radio] = await Promise.allSettled([
      importAudius({
        pages: req.query.audiusPages || 2,
        trendingLimit: req.query.audiusTrendingLimit || 100,
        searchLimit: req.query.audiusSearchLimit || 40,
        seedCount: req.query.audiusSeedCount || 15,
        seedOffset: req.query.audiusSeedOffset || 0,
        terms: audiusTerms,
      }),
      importArchive({
        rows: req.query.archiveRows || 6,
        pages: req.query.archivePages || 1,
        seedCount: req.query.archiveSeedCount || 10,
        seedOffset: req.query.archiveSeedOffset || 0,
        terms: archiveTerms,
      }),
      importRadio({
        limitPerTag: req.query.radioLimit || 25,
        seedCount: req.query.radioSeedCount || 10,
        seedOffset: req.query.radioSeedOffset || 0,
        tags: radioTags,
      }),
    ]);

    const stats = await getStats();

    res.json({
      ok: true,
      results: {
        audius:
          audius.status === "fulfilled"
            ? audius.value
            : { error: audius.reason?.message || "audius failed" },
        archive:
          archive.status === "fulfilled"
            ? archive.value
            : { error: archive.reason?.message || "archive failed" },
        radio:
          radio.status === "fulfilled"
            ? radio.value
            : { error: radio.reason?.message || "radio failed" },
      },
      stats,
    });
  } catch (error) {
    res.status(500).json({
      error: "import all error",
      message: error.message,
    });
  }
});

(async () => {
  try {
    await ensureDb();

    app.listen(PORT, () => {
      log(`AIMusic API started on port ${PORT}`);
    });

    if (AUTO_BOOTSTRAP) {
      setTimeout(() => {
        maybeBootstrap().catch((error) =>
          log("bootstrap crash:", error.message)
        );
      }, 2500);
    }
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
})();
