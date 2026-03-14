require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 10000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const APP_URL = process.env.APP_URL || 'https://aimusic-api.onrender.com';

const AUDIUS_API_BASE = process.env.AUDIUS_API_BASE || 'https://discoveryprovider.audius.co/v1';
const AUDIUS_AUTH_BASE = process.env.AUDIUS_AUTH_BASE || 'https://api.audius.co/v1';
const AUDIUS_STREAM_BASE = process.env.AUDIUS_STREAM_BASE || 'https://discoveryprovider.audius.co/v1';
const AUDIUS_API_BEARER_TOKEN = process.env.AUDIUS_API_BEARER_TOKEN || '';

const RADIO_BROWSER_BASE =
  process.env.RADIO_BROWSER_BASE || 'https://de1.api.radio-browser.info/json';

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
  stage: 'idle',
  startedAt: null,
  finishedAt: null,
  lastError: '',
  counters: {
    audius: 0,
    radio: 0,
    total: 0,
  },
};

const AUDIUS_GENRES = [
  '',
  'Electronic',
  'Hip-Hop/Rap',
  'Pop',
  'Rock',
  'Jazz',
  'Alternative',
  'House',
  'Techno',
  'Dubstep',
  'Lo-Fi',
  'Ambient',
  'Instrumental',
  'R&B/Soul',
  'Trap',
  'Drum & Bass',
  'Dance',
  'Indie',
  'Classical',
];

const AUDIUS_QUERIES = [
  'house',
  'deep house',
  'progressive house',
  'tech house',
  'techno',
  'melodic techno',
  'trance',
  'progressive trance',
  'edm',
  'electronic',
  'dance',
  'club',
  'dj mix',
  'remix',
  'radio edit',
  'dubstep',
  'drum and bass',
  'dnb',
  'jungle',
  'hardstyle',
  'phonk',
  'hip hop',
  'rap',
  'trap',
  'lofi',
  'lo-fi',
  'jazz',
  'blues',
  'rock',
  'indie',
  'pop',
  'synthwave',
  'ambient',
  'chill',
  'instrumental',
  'ukraine',
  'ukrainian',
  'ukrainian music',
  'russian',
  'latin',
  'reggaeton',
  'afrobeats',
  'soundtrack',
  'gaming music',
  'beats',
  'vocal',
  'female vocal',
  'male vocal',
  'underground',
  'future bass',
  'garage',
  'uk garage',
  'breakbeat',
  'electro',
  'house remix',
  'dance remix',
  'club mix',
];

const PLAYLIST_QUERIES = [
  'house',
  'techno',
  'trance',
  'electronic',
  'dance',
  'club',
  'hip hop',
  'rap',
  'phonk',
  'lofi',
  'rock',
  'indie',
  'pop',
  'synthwave',
  'ambient',
  'chill',
  'dubstep',
  'drum and bass',
];

const RADIO_TAGS = [
  'dance',
  'house',
  'deep house',
  'electronic',
  'edm',
  'techno',
  'trance',
  'pop',
  'rock',
  'jazz',
  'hiphop',
  'rap',
  'rnb',
  'lofi',
  'ambient',
  'chillout',
  'dubstep',
  'drum and bass',
  'hardstyle',
  'synthwave',
  'metal',
  'classical',
  'oldies',
  '80s',
  '90s',
  'top40',
  'hits',
  'club',
  'lounge',
  'disco',
  'funk',
  'reggaeton',
];

const RADIO_COUNTRIES = [
  'US', 'GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'PL', 'UA', 'CA',
  'AU', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'IE', 'PT', 'CZ',
  'RO', 'HU', 'TR', 'BR', 'AR', 'MX', 'JP', 'KR', 'IN', 'ZA',
];

const RADIO_LANGUAGES = [
  'english',
  'spanish',
  'french',
  'german',
  'italian',
  'portuguese',
  'polish',
  'ukrainian',
  'russian',
  'dutch',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function safeUrl(value) {
  const v = safeText(value).replace(/\s/g, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return '';
}

function makeHash(text) {
  return crypto.createHash('md5').update(String(text)).digest('hex');
}

function pickCover(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return safeUrl(raw);

  const candidates = [
    raw['150x150'],
    raw['480x480'],
    raw['1000x1000'],
    raw['640x'],
    raw['150x'],
    raw.url,
  ];

  for (const item of candidates) {
    const url = safeUrl(item);
    if (url) return url;
  }

  return '';
}

function baseScore(track) {
  let score = 0;

  if (track.source === 'radio') score += 1000000;
  if (track.source === 'audius') score += 100000;

  if (track.is_live) score += 200000;
  if (track.cover) score += 200;
  if (track.genre) score += 25;
  if (track.language) score += 10;

  return score;
}

function normalizeTrack(input) {
  const track = {
    id: safeText(input.id),
    title: safeText(input.title),
    artist: safeText(input.artist),
    album: safeText(input.album),
    stream: safeUrl(input.stream),
    cover: safeUrl(input.cover),
    page_url: safeUrl(input.page_url),
    source: safeText(input.source).toLowerCase(),
    is_live: Boolean(input.is_live),
    genre: safeText(input.genre),
    language: safeText(input.language),
    sort_score: Number(input.sort_score || 0),
  };

  if (!track.id || !track.title || !track.stream || !track.source) {
    return null;
  }

  return track;
}

function mapAudiusTrack(raw) {
  if (!raw || !raw.id) return null;

  const permalink = safeText(raw.permalink);
  const pageUrl = permalink
    ? permalink.startsWith('http')
      ? permalink
      : `https://audius.co${permalink.startsWith('/') ? '' : '/'}${permalink}`
    : '';

  const title = safeText(raw.title);
  const artist = safeText(raw.user?.name || raw.user?.handle || raw.artist);
  const cover = pickCover(raw.artwork || raw.cover_art || raw.coverArt || raw.cover);
  const genre = safeText(raw.genre);

  const track = normalizeTrack({
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
  });

  if (!track) return null;
  track.sort_score = baseScore(track);
  return track;
}

function mapRadioStation(raw) {
  if (!raw) return null;

  const stream = safeUrl(raw.url_resolved || raw.url);
  const stationuuid = safeText(raw.stationuuid || raw.uuid || raw.changeuuid || makeHash(stream));
  const title = safeText(raw.name);
  const artist = safeText(raw.country || raw.countrycode || raw.state || 'Radio');
  const cover = safeUrl(raw.favicon);
  const genre = safeText(raw.tags);
  const language = safeText(raw.language || raw.languagecodes);
  const votes = Number(raw.votes || 0);
  const clickcount = Number(raw.clickcount || 0);
  const bitrate = Number(raw.bitrate || 0);

  const track = normalizeTrack({
    id: `radio_${stationuuid}`,
    title,
    artist,
    album: '',
    stream,
    cover,
    page_url: safeUrl(raw.homepage),
    source: 'radio',
    is_live: true,
    genre,
    language,
  });

  if (!track) return null;
  track.sort_score = baseScore(track) + votes * 5 + clickcount * 3 + bitrate;
  return track;
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_source ON tracks(source);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_updated_at ON tracks(updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_sort_score ON tracks(sort_score DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_lower_title ON tracks((lower(title)));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_lower_artist ON tracks((lower(artist)));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_lower_genre ON tracks((lower(genre)));`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tracks_lower_language ON tracks((lower(language)));`);
}

async function upsertTracksBatch(tracks, chunkSize = 200) {
  const valid = tracks.filter(Boolean);
  if (!valid.length) return 0;

  let total = 0;

  for (let i = 0; i < valid.length; i += chunkSize) {
    const chunk = valid.slice(i, i + chunkSize);
    const values = [];
    const placeholders = [];

    chunk.forEach((track, index) => {
      const b = index * 12;
      placeholders.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12})`
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
        track.language,
        track.sort_score
      );
    });

    await pool.query(
      `
      INSERT INTO tracks (
        id, title, artist, album, stream, cover, page_url,
        source, is_live, genre, language, sort_score
      )
      VALUES ${placeholders.join(', ')}
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
        sort_score = EXCLUDED.sort_score,
        updated_at = NOW();
      `,
      values
    );

    total += chunk.length;
  }

  return total;
}

async function getSourcesActive() {
  const { rows } = await pool.query(
    `SELECT source FROM tracks GROUP BY source ORDER BY source;`
  );
  return rows.map((row) => row.source);
}

async function audiusGet(path, params = {}) {
  const useAuth = Boolean(AUDIUS_API_BEARER_TOKEN);
  const base = useAuth ? AUDIUS_AUTH_BASE : AUDIUS_API_BASE;
  const headers = useAuth ? { Authorization: `Bearer ${AUDIUS_API_BEARER_TOKEN}` } : {};

  const response = await http.get(`${base}${path}`, {
    params,
    headers,
  });

  return response.data;
}

async function radioSearch(params = {}) {
  const response = await http.get(`${RADIO_BROWSER_BASE}/stations/search`, {
    params,
  });
  return Array.isArray(response.data) ? response.data : [];
}

async function importAudiusTracksIntoMap(map) {
  importState.stage = 'audius_tracks';

  const trendingTimes = ['week', 'month', 'year', 'allTime'];

  for (const time of trendingTimes) {
    for (const genre of AUDIUS_GENRES) {
      for (const offset of [0, 100, 200]) {
        try {
          const data = await audiusGet('/tracks/trending', {
            time,
            limit: 100,
            offset,
            ...(genre ? { genre } : {}),
          });

          const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (!list.length) break;

          for (const item of list) {
            const track = mapAudiusTrack(item);
            if (track) map.set(track.id, track);
          }
        } catch (error) {
          console.error('Audius trending error:', time, genre, offset, error.message);
          break;
        }

        await sleep(120);
      }
    }
  }

  for (const offset of [0, 100, 200, 300, 400, 500]) {
    try {
      const data = await audiusGet('/tracks/underground', {
        limit: 100,
        offset,
      });

      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      if (!list.length) break;

      for (const item of list) {
        const track = mapAudiusTrack(item);
        if (track) map.set(track.id, track);
      }
    } catch (error) {
      console.error('Audius underground error:', offset, error.message);
      break;
    }

    await sleep(120);
  }

  for (const query of AUDIUS_QUERIES) {
    for (const offset of [0, 100, 200, 300, 400]) {
      try {
        const data = await audiusGet('/tracks/search', {
          query,
          limit: 100,
          offset,
        });

        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (!list.length) break;

        for (const item of list) {
          const track = mapAudiusTrack(item);
          if (track) map.set(track.id, track);
        }
      } catch (error) {
        console.error('Audius search error:', query, offset, error.message);
        break;
      }

      await sleep(120);
    }
  }
}

async function importAudiusPlaylistsIntoMap(map) {
  importState.stage = 'audius_playlists';

  const playlistIds = new Set();

  for (const time of ['week', 'month', 'year']) {
    for (const offset of [0, 100, 200]) {
      try {
        const data = await audiusGet('/playlists/trending', {
          time,
          limit: 100,
          offset,
        });

        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (!list.length) break;

        for (const item of list) {
          const id = safeText(item.id);
          if (id) playlistIds.add(id);
        }
      } catch (error) {
        console.error('Audius trending playlists error:', time, offset, error.message);
        break;
      }

      await sleep(120);
    }
  }

  for (const query of PLAYLIST_QUERIES) {
    for (const offset of [0, 100, 200]) {
      try {
        const data = await audiusGet('/playlists/search', {
          query,
          limit: 100,
          offset,
        });

        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (!list.length) break;

        for (const item of list) {
          const id = safeText(item.id);
          if (id) playlistIds.add(id);
        }
      } catch (error) {
        console.error('Audius search playlists error:', query, offset, error.message);
        break;
      }

      await sleep(120);
    }
  }

  const ids = [...playlistIds];

  for (let i = 0; i < ids.length; i++) {
    const playlistId = ids[i];

    try {
      const data = await audiusGet(`/playlists/${playlistId}/tracks`, {
        limit: 1000,
      });

      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      for (const item of list) {
        const track = mapAudiusTrack(item);
        if (track) map.set(track.id, track);
      }
    } catch (error) {
      console.error('Audius playlist tracks error:', playlistId, error.message);
    }

    await sleep(120);
  }
}

async function importAudius() {
  const map = new Map();

  await importAudiusTracksIntoMap(map);
  await importAudiusPlaylistsIntoMap(map);

  const saved = await upsertTracksBatch([...map.values()], 200);

  importState.counters.audius = saved;
  importState.counters.total =
    importState.counters.audius + importState.counters.radio;

  return saved;
}

async function importRadio() {
  importState.stage = 'radio';

  const map = new Map();

  const broadStrategies = [
    { order: 'votes', reverse: true, hidebroken: true, limit: 1000, offset: 0 },
    { order: 'clickcount', reverse: true, hidebroken: true, limit: 1000, offset: 0 },
    { order: 'lastchecktime', reverse: true, hidebroken: true, limit: 1000, offset: 0 },
  ];

  for (const params of broadStrategies) {
    try {
      const list = await radioSearch(params);
      for (const item of list) {
        const track = mapRadioStation(item);
        if (track) map.set(track.id, track);
      }
    } catch (error) {
      console.error('Radio broad import error:', error.message);
    }

    await sleep(120);
  }

  for (const tag of RADIO_TAGS) {
    for (const offset of [0, 250, 500]) {
      try {
        const list = await radioSearch({
          tagList: tag,
          order: 'votes',
          reverse: true,
          hidebroken: true,
          limit: 250,
          offset,
        });

        if (!list.length) break;

        for (const item of list) {
          const track = mapRadioStation(item);
          if (track) map.set(track.id, track);
        }
      } catch (error) {
        console.error('Radio tag import error:', tag, offset, error.message);
        break;
      }

      await sleep(120);
    }
  }

  for (const country of RADIO_COUNTRIES) {
    for (const offset of [0, 200, 400]) {
      try {
        const list = await radioSearch({
          countrycode: country,
          order: 'votes',
          reverse: true,
          hidebroken: true,
          limit: 200,
          offset,
        });

        if (!list.length) break;

        for (const item of list) {
          const track = mapRadioStation(item);
          if (track) map.set(track.id, track);
        }
      } catch (error) {
        console.error('Radio country import error:', country, offset, error.message);
        break;
      }

      await sleep(120);
    }
  }

  for (const language of RADIO_LANGUAGES) {
    for (const offset of [0, 200]) {
      try {
        const list = await radioSearch({
          language,
          order: 'votes',
          reverse: true,
          hidebroken: true,
          limit: 200,
          offset,
        });

        if (!list.length) break;

        for (const item of list) {
          const track = mapRadioStation(item);
          if (track) map.set(track.id, track);
        }
      } catch (error) {
        console.error('Radio language import error:', language, offset, error.message);
        break;
      }

      await sleep(120);
    }
  }

  const saved = await upsertTracksBatch([...map.values()], 200);

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
      import: importState,
    };
  }

  importState.running = true;
  importState.stage = 'starting';
  importState.startedAt = new Date().toISOString();
  importState.finishedAt = null;
  importState.lastError = '';
  importState.counters = { audius: 0, radio: 0, total: 0 };

  try {
    await initDb();

    if (reset) {
      importState.stage = 'reset';
      await pool.query(`TRUNCATE TABLE tracks;`);
    }

    await importRadio();
    await importAudius();

    importState.stage = 'done';
    importState.finishedAt = new Date().toISOString();

    return {
      ok: true,
      import: importState,
    };
  } catch (error) {
    importState.stage = 'failed';
    importState.lastError = error.message;
    importState.finishedAt = new Date().toISOString();
    console.error('Import failed:', error);

    return {
      ok: false,
      error: error.message,
      import: importState,
    };
  } finally {
    importState.running = false;
  }
}

function buildPagedResponse({ totalPool, rows, offset, limit, sourcesActive }) {
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
    primary_url: APP_URL,
    db: DATABASE_URL ? 'configured' : 'missing DATABASE_URL',
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
    const { rows } = await pool.query(`SELECT NOW() AS now;`);
    res.json({
      ok: true,
      db: true,
      now: rows[0].now,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      db: false,
      error: error.message,
    });
  }
});

app.get('/api/import/status', async (_req, res) => {
  res.json({
    ok: true,
    import: importState,
  });
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
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/api/trending', async (req, res) => {
  try {
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const source = safeText(req.query.source).toLowerCase();

    const filters = [];
    const values = [];

    if (source) {
      values.push(source);
      filters.push(`source = $${values.length}`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tracks ${whereSql};`,
      values
    );

    const totalPool = countResult.rows[0]?.total || 0;

    const queryValues = [...values, limit, offset];

    const rowsResult = await pool.query(
      `
      SELECT
        id, title, artist, album, stream, cover, page_url,
        source, is_live, genre, language
      FROM tracks
      ${whereSql}
      ORDER BY sort_score DESC, updated_at DESC, title ASC
      LIMIT $${queryValues.length - 1}
      OFFSET $${queryValues.length};
      `,
      queryValues
    );

    const sourcesActive = await getSourcesActive();

    res.json(
      buildPagedResponse({
        totalPool,
        rows: rowsResult.rows,
        offset,
        limit,
        sourcesActive,
      })
    );
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/api/new', async (req, res) => {
  try {
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const source = safeText(req.query.source).toLowerCase();

    const filters = [];
    const values = [];

    if (source) {
      values.push(source);
      filters.push(`source = $${values.length}`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tracks ${whereSql};`,
      values
    );

    const totalPool = countResult.rows[0]?.total || 0;

    const queryValues = [...values, limit, offset];

    const rowsResult = await pool.query(
      `
      SELECT
        id, title, artist, album, stream, cover, page_url,
        source, is_live, genre, language
      FROM tracks
      ${whereSql}
      ORDER BY updated_at DESC, sort_score DESC, title ASC
      LIMIT $${queryValues.length - 1}
      OFFSET $${queryValues.length};
      `,
      queryValues
    );

    const sourcesActive = await getSourcesActive();

    res.json(
      buildPagedResponse({
        totalPool,
        rows: rowsResult.rows,
        offset,
        limit,
        sourcesActive,
      })
    );
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = safeText(req.query.q);
    const source = safeText(req.query.source).toLowerCase();
    const offset = clampInt(req.query.offset, 0, 1000000, 0);
    const limit = clampInt(req.query.limit, 1, 100, 50);

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

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tracks ${whereSql};`,
      baseValues
    );

    const totalPool = countResult.rows[0]?.total || 0;

    const values = [
      ...baseValues,
      qLower,
      qLower,
      qPrefix,
      qPrefix,
      limit,
      offset,
    ];

    const rowsResult = await pool.query(
      `
      SELECT
        id, title, artist, album, stream, cover, page_url,
        source, is_live, genre, language
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
        rows: rowsResult.rows,
        offset,
        limit,
        sourcesActive,
      })
    );
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    ok: false,
    error: error.message || 'Server error',
  });
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
