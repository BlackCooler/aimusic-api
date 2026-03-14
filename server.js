const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
    })
  : null;

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 25000);
const BETWEEN_REQUESTS_MS = Number(process.env.BETWEEN_REQUESTS_MS || 120);

const AUDIOUS_LIMIT = Number(process.env.AUDIOUS_LIMIT || 100);
const AUDIOUS_MAX_PAGES = Number(process.env.AUDIOUS_MAX_PAGES || 20);

const RADIO_LIMIT = Number(process.env.RADIO_LIMIT || 200);

const AUDIOUS_TERMS = [
  "house",
  "deep house",
  "progressive house",
  "melodic house",
  "afro house",
  "tech house",
  "organic house",
  "electro house",
  "future house",
  "bass house",
  "slap house",
  "techno",
  "melodic techno",
  "hard techno",
  "minimal techno",
  "industrial techno",
  "trance",
  "progressive trance",
  "psytrance",
  "uplifting trance",
  "dance",
  "electronic",
  "edm",
  "festival",
  "club",
  "dj mix",
  "dubstep",
  "brostep",
  "future bass",
  "drum and bass",
  "liquid drum and bass",
  "neurofunk",
  "bass music",
  "phonk",
  "trap",
  "hip hop",
  "rap",
  "lofi",
  "chill",
  "ambient",
  "synthwave",
  "retrowave",
  "hardstyle",
  "uk garage",
  "garage",
  "pop",
  "rock",
  "indie",
  "jazz",
  "smooth jazz",
  "rnb",
  "soul",
  "latin",
  "reggaeton",
  "k-pop",
  "afrobeats",
];

const RADIO_TAGS = [
  "house",
  "deep house",
  "progressive house",
  "tech house",
  "techno",
  "trance",
  "dance",
  "electronic",
  "edm",
  "club",
  "dubstep",
  "drum and bass",
  "bass",
  "hiphop",
  "rap",
  "pop",
  "rock",
  "jazz",
  "smooth jazz",
  "oldies",
  "80s",
  "90s",
  "hits",
  "chillout",
  "ambient",
  "lounge",
  "hardstyle",
  "reggaeton",
  "latin",
  "indie",
];

const RADIO_COUNTRIES = [
  "United States",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Netherlands",
  "Belgium",
  "Poland",
  "Ukraine",
  "Canada",
  "Brazil",
  "Mexico",
  "Argentina",
  "Australia",
  "Japan",
];

const importState = {
  running: false,
  kind: null,
  started_at: null,
  finished_at: null,
  current_step: null,
  totals: {
    received: 0,
    affected: 0,
    skipped: 0,
    errors: 0,
  },
  details: {
    audius: { received: 0, affected: 0, skipped: 0, errors: 0 },
    radio: { received: 0, affected: 0, skipped: 0, errors: 0 },
  },
  logs: [],
  last_error: null,
};

function resetImportState(kind) {
  importState.running = true;
  importState.kind = kind;
  importState.started_at = new Date().toISOString();
  importState.finished_at = null;
  importState.current_step = "starting";
  importState.totals = { received: 0, affected: 0, skipped: 0, errors: 0 };
  importState.details = {
    audius: { received: 0, affected: 0, skipped: 0, errors: 0 },
    radio: { received: 0, affected: 0, skipped: 0, errors: 0 },
  };
  importState.logs = [];
  importState.last_error = null;
}

function finishImportState() {
  importState.running = false;
  importState.finished_at = new Date().toISOString();
  importState.current_step = "idle";
}

function logImport(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  importState.logs.push(line);
  if (importState.logs.length > 200) {
    importState.logs.shift();
  }
  console.log(line);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function safeString(value, max = 2000) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

function makeStableId(source, rawId, stream, title, artist) {
  const id = safeString(rawId, 500);
  if (id) return id;
  const streamValue = safeString(stream, 2000);
  if (streamValue) return `${source}_${streamValue}`;
  return `${source}_${safeString(title, 300)}_${safeString(artist, 300)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

async function ensureDb() {
  if (!pool) {
    throw new Error("DATABASE_URL is missing");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      stream TEXT NOT NULL DEFAULT '',
      stream_url TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      is_live BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS source_id TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS external_id TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS artist TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stream TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS stream_url TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS cover TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS page_url TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS genre TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT '';`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await pool.query(`
    UPDATE tracks
    SET source = 'unknown'
    WHERE COALESCE(source, '') = '';
  `);

  await pool.query(`
    UPDATE tracks
    SET stream = COALESCE(NULLIF(stream, ''), NULLIF(stream_url, ''), '')
    WHERE COALESCE(stream, '') = '';
  `);

  await pool.query(`
    UPDATE tracks
    SET stream_url = COALESCE(NULLIF(stream_url, ''), NULLIF(stream, ''), '')
    WHERE COALESCE(stream_url, '') = '';
  `);

  await pool.query(`
    UPDATE tracks
    SET source_id = CASE
      WHEN COALESCE(source_id, '') <> '' THEN source_id
      WHEN COALESCE(external_id, '') <> '' THEN external_id
      WHEN COALESCE(stream, '') <> '' THEN md5(stream)
      WHEN COALESCE(stream_url, '') <> '' THEN md5(stream_url)
      WHEN COALESCE(title, '') <> '' OR COALESCE(artist, '') <> '' THEN md5(COALESCE(title, '') || '|' || COALESCE(artist, '') || '|' || COALESCE(source, 'unknown'))
      ELSE md5(id::text)
    END
    WHERE COALESCE(source_id, '') = '';
  `);

  await pool.query(`
    UPDATE tracks
    SET external_id = CASE
      WHEN COALESCE(external_id, '') <> '' THEN external_id
      WHEN COALESCE(source_id, '') <> '' THEN source_id
      WHEN COALESCE(stream, '') <> '' THEN md5(stream)
      WHEN COALESCE(stream_url, '') <> '' THEN md5(stream_url)
      WHEN COALESCE(title, '') <> '' OR COALESCE(artist, '') <> '' THEN md5(COALESCE(title, '') || '|' || COALESCE(artist, '') || '|' || COALESCE(source, 'unknown'))
      ELSE md5(id::text)
    END
    WHERE COALESCE(external_id, '') = '';
  `);

  await pool.query(`
    UPDATE tracks
    SET updated_at = NOW()
    WHERE updated_at IS NULL;
  `);

  await pool.query(`
    UPDATE tracks
    SET created_at = NOW()
    WHERE created_at IS NULL;
  `);

  await pool.query(`
    DELETE FROM tracks a
    USING tracks b
    WHERE a.ctid < b.ctid
      AND COALESCE(a.source, '') = COALESCE(b.source, '')
      AND COALESCE(a.source_id, '') = COALESCE(b.source_id, '')
      AND COALESCE(a.source_id, '') <> '';
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tracks_source_source_id
    ON tracks(source, source_id);
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_updated_at ON tracks(updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_external_id ON tracks(external_id);`);
}

function normalizeAudiusTrack(track) {
  const rawId = safeString(track?.id, 300);
  const artwork =
    track?.artwork?.["480x480"] ||
    track?.artwork?.["1000x1000"] ||
    track?.artwork?.["150x150"] ||
    "";

  const artist =
    track?.user?.name ||
    track?.user?.handle ||
    track?.artist ||
    "";

  const pageUrl =
    safeString(track?.permalink, 2000) ||
    safeString(track?.url, 2000) ||
    "";

  const stream = rawId
    ? `https://discoveryprovider.audius.co/v1/tracks/${encodeURIComponent(rawId)}/stream`
    : "";

  const sourceId = makeStableId("audius", rawId, stream, track?.title, artist);

  if (!sourceId || !safeString(track?.title, 500) || !stream) {
    return null;
  }

  return {
    source: "audius",
    source_id: sourceId,
    external_id: sourceId,
    title: safeString(track?.title, 500),
    artist: safeString(artist, 500),
    album: safeString(track?.album_name || "", 500),
    stream,
    stream_url: stream,
    cover: safeString(artwork, 2000),
    page_url: pageUrl,
    genre: safeString(track?.genre || "", 500),
    language: safeString(track?.language || "", 200),
    is_live: false,
  };
}

function normalizeRadioTrack(track) {
  const stream = safeString(track?.url_resolved || track?.url, 2000);
  const title = safeString(track?.name || track?.title, 500);

  const rawId =
    safeString(track?.stationuuid, 300) ||
    safeString(track?.changeuuid, 300) ||
    safeString(track?.url_resolved, 500) ||
    safeString(track?.url, 500);

  const sourceId = makeStableId(
    "radio",
    rawId,
    stream,
    title,
    track?.country || track?.countrycode || ""
  );

  if (!sourceId || !stream || !title) {
    return null;
  }

  return {
    source: "radio",
    source_id: sourceId,
    external_id: sourceId,
    title,
    artist: safeString(track?.country || track?.countrycode || "", 500),
    album: "",
    stream,
    stream_url: stream,
    cover: safeString(track?.favicon || "", 2000),
    page_url: safeString(track?.homepage || "", 2000),
    genre: safeString(track?.tags || "", 1000),
    language: safeString(track?.language || track?.languagecodes || "", 200),
    is_live: true,
  };
}

async function upsertTrack(track) {
  if (!pool) throw new Error("DATABASE_URL is missing");
  if (!track) return 0;

  const source = safeString(track.source, 100);
  const sourceId = safeString(track.source_id, 500);
  const externalId = safeString(track.external_id || track.source_id, 500);
  const title = safeString(track.title, 500);
  const artist = safeString(track.artist, 500);
  const album = safeString(track.album, 500);
  const stream = safeString(track.stream || track.stream_url, 2000);
  const streamUrl = safeString(track.stream_url || track.stream, 2000);
  const cover = safeString(track.cover, 2000);
  const pageUrl = safeString(track.page_url, 2000);
  const genre = safeString(track.genre, 1000);
  const language = safeString(track.language, 200);
  const isLive = !!track.is_live;

  if (!source || !sourceId || !title || !stream || !streamUrl) {
    return 0;
  }

  await pool.query(
    `
    INSERT INTO tracks (
      source,
      source_id,
      external_id,
      title,
      artist,
      album,
      stream,
      stream_url,
      cover,
      page_url,
      genre,
      language,
      is_live,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT (source, source_id)
    DO UPDATE SET
      external_id = EXCLUDED.external_id,
      title = EXCLUDED.title,
      artist = EXCLUDED.artist,
      album = EXCLUDED.album,
      stream = EXCLUDED.stream,
      stream_url = EXCLUDED.stream_url,
      cover = EXCLUDED.cover,
      page_url = EXCLUDED.page_url,
      genre = EXCLUDED.genre,
      language = EXCLUDED.language,
      is_live = EXCLUDED.is_live,
      updated_at = NOW();
    `,
    [
      source,
      sourceId,
      externalId,
      title,
      artist,
      album,
      stream,
      streamUrl,
      cover,
      pageUrl,
      genre,
      language,
      isLive,
    ]
  );

  return 1;
}

async function getStats() {
  if (!pool) {
    return {
      total_tracks: 0,
      by_source: [],
      sources_active: [],
    };
  }

  const result = await pool.query(`
    SELECT source, COUNT(*)::int AS count
    FROM tracks
    GROUP BY source
    ORDER BY source;
  `);

  const bySource = result.rows.map((row) => ({
    source: row.source,
    count: Number(row.count),
  }));

  const totalTracks = bySource.reduce((sum, item) => sum + item.count, 0);

  return {
    total_tracks: totalTracks,
    by_source: bySource,
    sources_active: bySource.map((item) => item.source),
  };
}

async function importAudiusJob() {
  const seen = new Set();
  importState.current_step = "audius";

  for (const term of AUDIOUS_TERMS) {
    logImport(`Audius term: ${term}`);

    for (let page = 0; page < AUDIOUS_MAX_PAGES; page++) {
      const offset = page * AUDIOUS_LIMIT;
      const url =
        `https://discoveryprovider.audius.co/v1/tracks/search` +
        `?query=${encodeURIComponent(term)}` +
        `&limit=${AUDIOUS_LIMIT}` +
        `&offset=${offset}`;

      let data;
      try {
        data = await fetchJson(url);
      } catch (error) {
        importState.totals.errors += 1;
        importState.details.audius.errors += 1;
        importState.last_error = error.message;
        logImport(`Audius fetch error: ${error.message}`);
        await sleep(BETWEEN_REQUESTS_MS);
        continue;
      }

      const items = Array.isArray(data?.data) ? data.data : [];
      if (!items.length) break;

      let pageAffected = 0;

      for (const rawTrack of items) {
        importState.totals.received += 1;
        importState.details.audius.received += 1;

        const normalized = normalizeAudiusTrack(rawTrack);
        if (!normalized) {
          importState.totals.skipped += 1;
          importState.details.audius.skipped += 1;
          continue;
        }

        const dedupeKey = `${normalized.source}:${normalized.source_id}`;
        if (seen.has(dedupeKey)) {
          importState.totals.skipped += 1;
          importState.details.audius.skipped += 1;
          continue;
        }

        seen.add(dedupeKey);

        try {
          const affected = await upsertTrack(normalized);
          importState.totals.affected += affected;
          importState.details.audius.affected += affected;
          pageAffected += affected;
        } catch (error) {
          importState.totals.errors += 1;
          importState.details.audius.errors += 1;
          importState.last_error = error.message;
          logImport(`Audius upsert error: ${error.message}`);
        }
      }

      if (items.length < AUDIOUS_LIMIT) break;
      if (pageAffected === 0 && page >= 2) break;

      await sleep(BETWEEN_REQUESTS_MS);
    }
  }

  logImport(
    `Audius done: received=${importState.details.audius.received}, affected=${importState.details.audius.affected}, errors=${importState.details.audius.errors}`
  );
}

async function importRadioJob() {
  const seen = new Set();
  importState.current_step = "radio";

  for (const tag of RADIO_TAGS) {
    const url =
      `https://de1.api.radio-browser.info/json/stations/bytag/${encodeURIComponent(tag)}` +
      `?hidebroken=true&order=votes&reverse=true&limit=${RADIO_LIMIT}`;

    logImport(`Radio tag: ${tag}`);

    let items = [];
    try {
      items = await fetchJson(url);
      if (!Array.isArray(items)) items = [];
    } catch (error) {
      importState.totals.errors += 1;
      importState.details.radio.errors += 1;
      importState.last_error = error.message;
      logImport(`Radio tag fetch error: ${error.message}`);
      await sleep(BETWEEN_REQUESTS_MS);
      continue;
    }

    for (const rawTrack of items) {
      importState.totals.received += 1;
      importState.details.radio.received += 1;

      const normalized = normalizeRadioTrack(rawTrack);
      if (!normalized) {
        importState.totals.skipped += 1;
        importState.details.radio.skipped += 1;
        continue;
      }

      const dedupeKey = `${normalized.source}:${normalized.source_id}`;
      if (seen.has(dedupeKey)) {
        importState.totals.skipped += 1;
        importState.details.radio.skipped += 1;
        continue;
      }

      seen.add(dedupeKey);

      try {
        const affected = await upsertTrack(normalized);
        importState.totals.affected += affected;
        importState.details.radio.affected += affected;
      } catch (error) {
        importState.totals.errors += 1;
        importState.details.radio.errors += 1;
        importState.last_error = error.message;
        logImport(`Radio upsert error: ${error.message}`);
      }
    }

    await sleep(BETWEEN_REQUESTS_MS);
  }

  for (const country of RADIO_COUNTRIES) {
    const url =
      `https://de1.api.radio-browser.info/json/stations/bycountry/${encodeURIComponent(country)}` +
      `?hidebroken=true&order=votes&reverse=true&limit=${RADIO_LIMIT}`;

    logImport(`Radio country: ${country}`);

    let items = [];
    try {
      items = await fetchJson(url);
      if (!Array.isArray(items)) items = [];
    } catch (error) {
      importState.totals.errors += 1;
      importState.details.radio.errors += 1;
      importState.last_error = error.message;
      logImport(`Radio country fetch error: ${error.message}`);
      await sleep(BETWEEN_REQUESTS_MS);
      continue;
    }

    for (const rawTrack of items) {
      importState.totals.received += 1;
      importState.details.radio.received += 1;

      const normalized = normalizeRadioTrack(rawTrack);
      if (!normalized) {
        importState.totals.skipped += 1;
        importState.details.radio.skipped += 1;
        continue;
      }

      const dedupeKey = `${normalized.source}:${normalized.source_id}`;
      if (seen.has(dedupeKey)) {
        importState.totals.skipped += 1;
        importState.details.radio.skipped += 1;
        continue;
      }

      seen.add(dedupeKey);

      try {
        const affected = await upsertTrack(normalized);
        importState.totals.affected += affected;
        importState.details.radio.affected += affected;
      } catch (error) {
        importState.totals.errors += 1;
        importState.details.radio.errors += 1;
        importState.last_error = error.message;
        logImport(`Radio upsert error: ${error.message}`);
      }
    }

    await sleep(BETWEEN_REQUESTS_MS);
  }

  logImport(
    `Radio done: received=${importState.details.radio.received}, affected=${importState.details.radio.affected}, errors=${importState.details.radio.errors}`
  );
}

async function backgroundImport(kind) {
  if (importState.running) {
    return false;
  }

  resetImportState(kind);
  logImport(`Background import started: ${kind}`);

  (async () => {
    try {
      await ensureDb();

      if (kind === "audius") {
        await importAudiusJob();
      } else if (kind === "radio") {
        await importRadioJob();
      } else if (kind === "all") {
        await importAudiusJob();
        await importRadioJob();
      } else {
        throw new Error(`Unknown import kind: ${kind}`);
      }

      logImport(`Background import finished: ${kind}`);
    } catch (error) {
      importState.last_error = error.message;
      importState.totals.errors += 1;
      logImport(`Background import failed: ${error.message}`);
    } finally {
      finishImportState();
    }
  })();

  return true;
}

function publicImportState() {
  return {
    running: importState.running,
    kind: importState.kind,
    started_at: importState.started_at,
    finished_at: importState.finished_at,
    current_step: importState.current_step,
    totals: importState.totals,
    details: importState.details,
    last_error: importState.last_error,
    logs: importState.logs.slice(-40),
  };
}

app.get("/", async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({
      ok: true,
      app: "AIMusic API",
      database: Boolean(pool),
      total_tracks: stats.total_tracks,
      by_source: stats.by_source,
      sources_active: stats.sources_active,
      endpoints: {
        health: "/api/health",
        stats: "/api/stats",
        trending: "/api/trending?offset=0&limit=50",
        search: "/api/search?q=house&offset=0&limit=50",
        import_all: "/api/import/all",
        import_audius: "/api/import/audius",
        import_radio: "/api/import/radio",
        import_status: "/api/import/status",
      },
      import_tuning: {
        audius_limit: AUDIOUS_LIMIT,
        audius_max_pages: AUDIOUS_MAX_PAGES,
        radio_limit: RADIO_LIMIT,
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    await ensureDb();
    res.json({ ok: true, database: true });
  } catch (error) {
    res.status(500).json({ ok: false, database: false, error: error.message });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/import/status", async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({
      ...publicImportState(),
      stats,
    });
  } catch (error) {
    res.status(500).json({
      ...publicImportState(),
      error: error.message,
    });
  }
});

app.get("/api/import/all", async (_req, res) => {
  try {
    const started = await backgroundImport("all");
    res.json({
      ok: true,
      started,
      message: started
        ? "Background import started"
        : "Import already running",
      status_url: "/api/import/status",
      status: publicImportState(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/import/audius", async (_req, res) => {
  try {
    const started = await backgroundImport("audius");
    res.json({
      ok: true,
      started,
      message: started
        ? "Background Audius import started"
        : "Import already running",
      status_url: "/api/import/status",
      status: publicImportState(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/import/radio", async (_req, res) => {
  try {
    const started = await backgroundImport("radio");
    res.json({
      ok: true,
      started,
      message: started
        ? "Background Radio import started"
        : "Import already running",
      status_url: "/api/import/status",
      status: publicImportState(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/trending", async (req, res) => {
  try {
    await ensureDb();

    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);

    const totalResult = await pool.query(`SELECT COUNT(*)::int AS count FROM tracks;`);
    const totalPool = Number(totalResult.rows[0]?.count || 0);

    const rowsResult = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(source_id, ''), NULLIF(external_id, ''), md5(COALESCE(stream, stream_url, ''))) AS id,
        title,
        artist,
        album,
        COALESCE(NULLIF(stream, ''), stream_url) AS stream,
        cover,
        page_url,
        source,
        is_live,
        genre,
        language
      FROM tracks
      ORDER BY updated_at DESC, created_at DESC, title ASC
      OFFSET $1
      LIMIT $2;
      `,
      [offset, limit]
    );

    const tracks = rowsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      stream: row.stream,
      cover: row.cover,
      page_url: row.page_url,
      source: row.source,
      is_live: row.is_live,
      genre: row.genre,
      language: row.language,
    }));

    const nextOffset = offset + tracks.length < totalPool ? offset + tracks.length : null;
    const stats = await getStats();

    res.json({
      total_pool: totalPool,
      total_returned: tracks.length,
      offset,
      limit,
      next_offset: nextOffset,
      sources_active: stats.sources_active,
      tracks,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    await ensureDb();

    const q = safeString(req.query.q || "", 200);
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);

    if (!q) {
      return res.status(400).json({
        error: "Missing q parameter",
        example: "/api/search?q=house&offset=0&limit=50",
      });
    }

    const like = `%${q.toLowerCase()}%`;

    const totalResult = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM tracks
      WHERE
        LOWER(title) LIKE $1 OR
        LOWER(artist) LIKE $1 OR
        LOWER(album) LIKE $1 OR
        LOWER(genre) LIKE $1 OR
        LOWER(language) LIKE $1;
      `,
      [like]
    );

    const totalPool = Number(totalResult.rows[0]?.count || 0);

    const rowsResult = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(source_id, ''), NULLIF(external_id, ''), md5(COALESCE(stream, stream_url, ''))) AS id,
        title,
        artist,
        album,
        COALESCE(NULLIF(stream, ''), stream_url) AS stream,
        cover,
        page_url,
        source,
        is_live,
        genre,
        language
      FROM tracks
      WHERE
        LOWER(title) LIKE $1 OR
        LOWER(artist) LIKE $1 OR
        LOWER(album) LIKE $1 OR
        LOWER(genre) LIKE $1 OR
        LOWER(language) LIKE $1
      ORDER BY updated_at DESC, created_at DESC, title ASC
      OFFSET $2
      LIMIT $3;
      `,
      [like, offset, limit]
    );

    const tracks = rowsResult.rows.map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      stream: row.stream,
      cover: row.cover,
      page_url: row.page_url,
      source: row.source,
      is_live: row.is_live,
      genre: row.genre,
      language: row.language,
    }));

    const nextOffset = offset + tracks.length < totalPool ? offset + tracks.length : null;
    const stats = await getStats();

    res.json({
      q,
      total_pool: totalPool,
      total_returned: tracks.length,
      offset,
      limit,
      next_offset: nextOffset,
      sources_active: stats.sources_active,
      tracks,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    error: "Not found",
    endpoints: {
      root: "/",
      health: "/api/health",
      stats: "/api/stats",
      trending: "/api/trending?offset=0&limit=50",
      search: "/api/search?q=house&offset=0&limit=50",
      import_all: "/api/import/all",
      import_audius: "/api/import/audius",
      import_radio: "/api/import/radio",
      import_status: "/api/import/status",
    },
  });
});

async function bootstrap() {
  try {
    if (pool) {
      await ensureDb();
    }

    app.listen(PORT, () => {
      console.log(`AIMusic API started on port ${PORT}`);
    });
  } catch (error) {
    console.error("Bootstrap error:", error);
    process.exit(1);
  }
}

bootstrap();
