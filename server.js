require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const APP_URL = process.env.APP_URL || 'https://aimusic-api.onrender.com';
const AUDIUS_API_BEARER_TOKEN = process.env.AUDIUS_API_BEARER_TOKEN || '';
const RADIO_BROWSER_BASE =
  process.env.RADIO_BROWSER_BASE || 'https://de1.api.radio-browser.info/json';
const AUDIUS_PUBLIC_BASE =
  process.env.AUDIUS_PUBLIC_BASE || 'https://discoveryprovider.audius.co/v1';
const AUDIUS_AUTH_BASE =
  process.env.AUDIUS_AUTH_BASE || 'https://api.audius.co/v1';
const AUDIUS_STREAM_BASE =
  process.env.AUDIUS_STREAM_BASE || 'https://discoveryprovider.audius.co/v1';
const USER_AGENT =
  process.env.USER_AGENT || 'AIMusic/1.0 (+https://aimusic-api.onrender.com)';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    DATABASE_URL &&
    !/localhost|127\.0\.0\.1/.test(DATABASE_URL) &&
    !DATABASE_URL.includes('.internal')
      ? { rejectUnauthorized: false }
      : false,
});

const http = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  },
});

const importState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  stage: 'idle',
  lastError: '',
  counters: {
    audius: 0,
    radio: 0,
    total: 0,
  },
};

function toText(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function toUrl(value) {
  const v = toText(value).replace(/\s/g, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return '';
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function chooseCover(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return toUrl(raw);

  const candidates = [
    raw['1000x1000'],
    raw['480x480'],
    raw['150x150'],
    raw['640x'],
    raw['150x'],
    raw.url,
  ];

  for (const c of candidates) {
    const u = toUrl(c);
    if (u) return u;
  }

  return '';
}

function scoreTrack(track) {
  let score = 0;
  if (track.source === 'radio') score += 1000000;
  if (track.source === 'audius') score += 10000;
  if (track.is_live) score += 500000;
  if (track.cover) score += 100;
  if (track.genre) score += 10;
  return score;
}

function normalizeTrack(input) {
  const track = {
    id: toText(input.id),
    title: toText(input.title),
    artist: toText(input.artist),
    album: toText(input.album),
    stream: toUrl(input.stream),
    cover: toUrl(input.cover),
    page_url: toUrl(input.page_url),
    source: toText(input.source).toLowerCase(),
    is_live: Boolean(input.is_live),
    genre: toText(input.genre),
    language: toText(input.language),
  };

  if (!track.id || !track.title || !track.stream || !track.source) {
    return null;
  }

  track.sort_score = Number(input.sort_score || scoreTrack(track)) || 0;
  return track;
}

function mapAudiusTrack(raw) {
  if (!raw || !raw.id) return null;

  let pageUrl = '';
  const permalink = toText(raw.permalink);

  if (permalink) {
    pageUrl = permalink.startsWith('http')
      ? permalink
      : `https://audius.co${permalink.startsWith('/') ? '' : '/'}${permalink}`;
  }

  const title = toText(raw.title);
  const artist = toText(raw.user?.name || raw.user?.handle || raw.artist);
  const genre = toText(raw.genre);
  const cover = chooseCover(
    raw.artwork || raw.cover_art || raw.coverArt || raw.cover
  );

  return normalizeTrack({
    id: `audius_${raw.id}`,
    title,
    artist,
    album: '',
    stream: `${AUDIUS_STREAM_BASE}/tracks/${raw.id}/stream`,
    cover,
    page_url: pageUrl,
    source: 'audius',
    is_live: false,
    genre,
    language: '',
    sort_score: scoreTrack({
      source: 'audius',
      is_live: false,
      cover,
      genre,
    }),
  });
}

function mapRadioStation(raw) {
  if (!raw) return null;

  const stream = toUrl(raw.url_resolved || raw.url);
  const stationId = toText(
    raw.stationuuid || raw.uuid || raw.changeuuid || md5(stream || JSON.stringify(raw))
  );
  const title = toText(raw.name);
  const cover = toUrl(raw.favicon);
  const artist = toText(raw.country || raw.countrycode || raw.state || 'Radio');
  const genre = toText(raw.tags);
  const language = toText(raw.language);
  const votes = Number(raw.votes || 0);
  const clickcount = Number(raw.clickcount || 0);

  return normalizeTrack({
    id: `radio_${stationId}`,
    title,
    artist,
    album: '',
    stream,
    cover,
    page_url: toUrl(raw.homepage),
    source: 'radio',
    is_live: true,
    genre,
    language,
    sort_score: 1000000 + votes * 5 + clickcount * 3 + (cover ? 100 : 0),
  });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      stream TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      is_live BOOLEAN NOT NULL DEFAULT FALSE,
      genre TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      sort_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_updated_at ON tracks(updated_at DESC);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_sort_score ON tracks(sort_score DESC);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_title_lower ON tracks((lower(title)));`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_artist_lower ON tracks((lower(artist)));`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_genre_lower ON tracks((lower(genre)));`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_tracks_language_lower ON tracks((lower(language)));`
  );
}

async function upsertTracksBatch(tracks, chunkSize = 100) {
  const valid = tracks.filter(Boolean);
  if (!valid.length) return 0;

  let saved = 0;

  for (let i = 0; i < valid.length; i += chunkSize) {
    const chunk = valid.slice(i, i + chunkSize);
    const values = [];
    const placeholders = [];

    chunk.forEach((track, index) => {
      const base = index * 11;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`
      );
      values.push(
        track.id,
        track.title,
        track.artist,
        track.album,
        track.stream,
        track.cover,
        track.page_url,
        track.source,
        track.is_live,
        track.genre,
        track.language
      );
    });

    const scoreCases = chunk
      .map(
        (track, index) =>
          `WHEN id = $${index * 11 + 1} THEN ${Number(track.sort_score || 0)}`
      )
      .join(' ');

    await pool.query(
      `
      INSERT INTO tracks (
        id, title, artist, album, stream, cover, page_url, source, is_live, genre, language
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        album = EXCLUDED.album,
        stream = EXCLUDED.stream,
        cover = EXCLUDED.cover,
        page_url = EXCLUDED.page_url,
        source = EXCLUDED.source,
        is_live = EXCLUDED.is_live,
        genre = EXCLUDED.genre,
        language = EXCLUDED.language,
        updated_at = NOW(),
        sort_score = CASE ${scoreCases} ELSE tracks.sort_score END;
      `,
      values
    );

    saved += chunk.length;
  }

  return saved;
}

async function getSourcesActive() {
  const { rows } = await pool.query(
    `SELECT source FROM tracks GROUP BY source ORDER BY source;`
  );
  return rows.map((row) => row.source);
}

async function audiusGet(path, params = {}) {
  const hasToken = Boolean(AUDIUS_API_BEARER_TOKEN);
  const baseUrl = hasToken ? AUDIUS_AUTH_BASE : AUDIUS_PUBLIC_BASE;
  const headers = hasToken
    ? { Authorization: `Bearer ${AUDIUS_API_BEARER_TOKEN}` }
    : {};

  const response = await http.get(`${baseUrl}${path}`, {
    params,
    headers,
  });

  return response.data;
}

async function importAudius() {
  importState.stage = 'importing_audius';

  const collected = new Map();

  const trendingGenres = [
    '',
    'Electronic',
    'Hip-Hop/Rap',
    'Pop',
    'Rock',
    'Jazz',
    'Alternative',
    'House',
    'Techno',
    'Lo-Fi',
  ];

  for (const genre of trendingGenres) {
    try {
      const data = await audiusGet('/tracks/trending', {
        limit: 100,
        offset: 0,
        time: 'allTime',
        ...(genre ? { genre } : {}),
      });

      const list = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];

      for (const raw of list) {
        const track = mapAudiusTrack(raw);
        if (track) collected.set(track.id, track);
      }
    } catch (error) {
      console.error('Audius trending import error:', genre || 'all', error.message);
    }
  }

  const searchQueries = [
    'house',
    'deep house',
    'techno',
    'trance',
    'dance',
    'electronic',
    'edm',
    'phonk',
    'hip hop',
    'rap',
    'pop',
    'rock',
    'metal',
    'jazz',
    'lofi',
    'ambient',
    'chill',
    'dubstep',
    'drum and bass',
    'hardstyle',
    'ukraine',
    'ukrainian',
    'russian',
    'latin',
    'indie',
    'club',
    'remix',
    'instrumental',
    'soundtrack',
    'synthwave',
  ];

  for (const query of searchQueries) {
    for (const offset of [0, 100, 200]) {
      try {
        const data = await audiusGet('/tracks/search', {
          query,
          limit: 100,
          offset,
        });

        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data)
          ? data
          : [];

        if (!list.length) break;

        for (const raw of list) {
          const track = mapAudiusTrack(raw);
          if (track) collected.set(track.id, track);
        }
      } catch (error) {
        console.error(
          `Audius search import error for query="${query}" offset=${offset}:`,
          error.message
        );
        break;
      }
    }
  }

  const saved = await upsertTracksBatch([...collected.values()], 100);
  importState.counters.audius = saved;
  importState.counters.total =
    importState.counters.audius + importState.counters.radio;

  return saved;
}

async function radioSearch(params) {
  const response = await http.get(`${RADIO_BROWSER_BASE}/stations/search`, {
    params,
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function importRadio() {
  importState.stage = 'importing_radio';

  const collected = new Map();

  const searchSets = [
    { order: 'votes', reverse: true, hidebroken: true, limit: 1000, offset: 0 },
    { order: 'clickcount', reverse: true, hidebroken: true, limit: 1000, offset: 0 },
    { order: 'lastchecktime', reverse: true, hidebroken: true, limit: 1000, offset: 0 },
    { tag: 'dance', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'house', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'electronic', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'pop', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'rock', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'jazz', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'hiphop', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'trance', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'techno', order: 'votes', reverse: true, hidebroken: true, limit: 800, offset: 0 },
    { tag: 'ukraine', order: 'votes', reverse: true, hidebroken: true, limit: 400, offset: 0 },
    { tag: 'russian', order: 'votes', reverse: true, hidebroken: true, limit: 400, offset: 0 },
  ];

  for (const params of searchSets) {
    try {
      const list = await radioSearch(params);

      for (const raw of list) {
        const track = mapRadioStation(raw);
        if (track) collected.set(track.id, track);
      }
    } catch (error) {
      console.error('Radio import error:', params, error.message);
    }
  }

  const saved = await upsertTracksBatch([...collected.values()], 100);
  importState.counters.radio = saved;
  importState.counters.total =
    importState.counters.audius + importState.counters.radio;

  return saved;
}

async function runFullImport({ reset = false } = {}) {
  if (importState.running) {
    return {
      ok: true,
      alreadyRunning: true,
      importState,
    };
  }

  importState.running = true;
  importState.startedAt = new Date().toISOString();
  importState.finishedAt = null;
  importState.stage = 'starting';
  importState.lastError = '';
  importState.counters = { audius: 0, radio: 0, total: 0 };

  try {
    await initDb();

    if (reset) {
      importState.stage = 'resetting';
      await pool.query(`TRUNCATE TABLE tracks;`);
    }

    await importRadio();
    await importAudius();

    importState.stage = 'done';
    importState.finishedAt = new Date().toISOString();

    return {
      ok: true,
      importState,
    };
  } catch (error) {
    importState.stage = 'failed';
    importState.lastError = error.message;
    importState.finishedAt = new Date().toISOString();
    console.error('Full import failed:', error);

    return {
      ok: false,
      error: error.message,
      importState,
    };
  } finally {
    importState.running = false;
  }
}

function buildPagedResponse({ totalPool, offset, limit, rows, sourcesActive }) {
  const nextOffset = offset + rows.length < totalPool ? offset + limit : null;

  return {
    total_pool: totalPool,
    total_returned: rows.length,
    offset,
    limit,
    next_offset: nextOffset,
    sources_active: sourcesActive,
    tracks: rows,
  };
}

app.get('/', async (_req, res) => {
  res.json({
    ok: true,
    name: 'AIMusic API',
    database: DATABASE_URL ? 'connected' : 'missing DATABASE_URL',
    endpoints: {
      health: '/api/health',
      stats: '/api/stats',
      trending: '/api/trending?offset=0&limit=50',
      new: '/api/new?offset=0&limit=50',
      search: '/api/search?q=house&offset=0&limit=50',
      import_all: '/api/import/all',
      import_status: '/api/import/status',
    },
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS now;');
    res.json({ ok: true, db: true, now: rows[0].now });
  } catch (error) {
    res.status(500).json({ ok: false, db: false, error: error.message });
  }
});

app.get('/api/import/status', async (_req, res) => {
  res.json({ ok: true, import: importState });
});

app.get('/api/import/all', async (req, res) => {
  const reset =
    String(req.query.reset || '').toLowerCase() === '1' ||
    String(req.query.reset || '').toLowerCase() === 'true';

  if (importState.running) {
    return res.json({
      ok: true,
      started: false,
      message: 'Import is already running',
      import: importState,
    });
  }

  setTimeout(() => {
    runFullImport({ reset }).catch((error) => {
      console.error('Background import error:', error);
    });
  }, 0);

  res.json({
    ok: true,
    started: true,
    reset,
    message: 'Background import started',
  });
});

app.get('/api/stats', async (_req, res) => {
  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total_tracks FROM tracks;`
    );

    const bySourceResult = await pool.query(`
      SELECT source, COUNT(*)::int AS count
      FROM tracks
      GROUP BY source
      ORDER BY count DESC, source ASC;
    `);

    const sourcesActive = bySourceResult.rows.map((row) => row.source);

    res.json({
      total_tracks: totalResult.rows[0]?.total_tracks || 0,
      by_source: bySourceResult.rows,
      sources_active: sourcesActive,
      import: importState,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const source = toText(req.query.source).toLowerCase();

    const filters = [];
    const values = [];

    if (source) {
      values.push(source);
      filters.push(`source = $${values.length}`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countQuery = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tracks ${whereSql};`,
      values
    );

    const totalPool = countQuery.rows[0]?.total || 0;

    values.push(limit, offset);

    const rowsQuery = await pool.query(
      `
      SELECT
        id, title, artist, album, stream, cover, page_url, source,
        is_live, genre, language
      FROM tracks
      ${whereSql}
      ORDER BY sort_score DESC, updated_at DESC, title ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length};
      `,
      values
    );

    const sourcesActive = await getSourcesActive();

    res.json(
      buildPagedResponse({
        totalPool,
        offset,
        limit,
        rows: rowsQuery.rows,
        sourcesActive,
      })
    );
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/new', async (req, res) => {
  try {
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const source = toText(req.query.source).toLowerCase();

    const filters = [];
    const values = [];

    if (source) {
      values.push(source);
      filters.push(`source = $${values.length}`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countQuery = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tracks ${whereSql};`,
      values
    );

    const totalPool = countQuery.rows[0]?.total || 0;

    values.push(limit, offset);

    const rowsQuery = await pool.query(
      `
      SELECT
        id, title, artist, album, stream, cover, page_url, source,
        is_live, genre, language
      FROM tracks
      ${whereSql}
      ORDER BY updated_at DESC, sort_score DESC, title ASC
      LIMIT $${values.length - 1}
      OFFSET $${values.length};
      `,
      values
    );

    const sourcesActive = await getSourcesActive();

    res.json(
      buildPagedResponse({
        totalPool,
        offset,
        limit,
        rows: rowsQuery.rows,
        sourcesActive,
      })
    );
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = toText(req.query.q);
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const source = toText(req.query.source).toLowerCase();

    if (!q) {
      return res.redirect(
        `/api/trending?offset=${offset}&limit=${limit}${
          source ? `&source=${encodeURIComponent(source)}` : ''
        }`
      );
    }

    const qLower = q.toLowerCase();
    const qLike = `%${qLower}%`;
    const qPrefix = `${qLower}%`;

    const filters = [
      `(lower(title) LIKE $1 OR lower(artist) LIKE $1 OR lower(album) LIKE $1 OR lower(genre) LIKE $1 OR lower(language) LIKE $1)`,
    ];

    const baseValues = [qLike];

    if (source) {
      baseValues.push(source);
      filters.push(`source = $${baseValues.length}`);
    }

    const whereSql = `WHERE ${filters.join(' AND ')}`;

    const countQuery = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tracks ${whereSql};`,
      baseValues
    );

    const totalPool = countQuery.rows[0]?.total || 0;

    const values = [
      ...baseValues,
      qLower,
      qLower,
      qPrefix,
      qPrefix,
      limit,
      offset,
    ];

    const rowsQuery = await pool.query(
      `
      SELECT
        id, title, artist, album, stream, cover, page_url, source,
        is_live, genre, language
      FROM tracks
      ${whereSql}
      ORDER BY
        CASE
          WHEN lower(title) = $${baseValues.length + 1} THEN 0
          WHEN lower(artist) = $${baseValues.length + 2} THEN 1
          WHEN lower(title) LIKE $${baseValues.length + 3} THEN 2
          WHEN lower(artist) LIKE $${baseValues.length + 4} THEN 3
          ELSE 4
        END,
        sort_score DESC,
        updated_at DESC,
        title ASC
      LIMIT $${baseValues.length + 5}
      OFFSET $${baseValues.length + 6};
      `,
      values
    );

    const sourcesActive = await getSourcesActive();

    res.json(
      buildPagedResponse({
        totalPool,
        offset,
        limit,
        rows: rowsQuery.rows,
        sourcesActive,
      })
    );
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: error.message || 'Server error' });
});

async function start() {
  await initDb();

  app.listen(PORT, () => {
    console.log(`AIMusic API started on port ${PORT}`);
    console.log(`Primary URL: ${APP_URL}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
