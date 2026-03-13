const express = require("express");
const fetch = require("node-fetch");

const app = express();

async function getAudius() {
  const res = await fetch(
    "https://discoveryprovider.audius.co/v1/tracks/trending?limit=100"
  );
  const data = await res.json();

  return data.data.map(t => ({
    id: "audius_" + t.id,
    title: t.title,
    artist: t.user.name,
    stream: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
    cover: t.artwork ? t.artwork["480x480"] : "",
    source: "audius"
  }));
}

async function getJamendo() {
  const res = await fetch(
    "https://api.jamendo.com/v3.0/tracks/?client_id=demo&limit=100"
  );
  const data = await res.json();

  return data.results.map(t => ({
    id: "jamendo_" + t.id,
    title: t.name,
    artist: t.artist_name,
    stream: t.audio,
    cover: t.album_image,
    source: "jamendo"
  }));
}

async function getArchive() {
  const res = await fetch(
    "https://archive.org/advancedsearch.php?q=mediatype:audio AND subject:music&rows=100&output=json"
  );
  const data = await res.json();

  return data.response.docs.map(t => ({
    id: "archive_" + t.identifier,
    title: t.title || "Unknown",
    artist: t.creator || "Unknown",
    stream: `https://archive.org/download/${t.identifier}`,
    cover: "",
    source: "archive"
  }));
}

async function getPixabay() {
  const res = await fetch(
    "https://pixabay.com/api/music/?key=31269580-7c7a2c2e1a1c7a7d4e9bfa3e8"
  );
  const data = await res.json();

  return data.hits.map(t => ({
    id: "pixabay_" + t.id,
    title: t.tags,
    artist: t.user,
    stream: t.audio,
    cover: "",
    source: "pixabay"
  }));
}

async function getRadio() {
  const res = await fetch(
    "https://de1.api.radio-browser.info/json/stations/bytag/music"
  );
  const data = await res.json();

  return data.slice(0, 100).map(t => ({
    id: "radio_" + t.stationuuid,
    title: t.name,
    artist: t.country,
    stream: t.url,
    cover: t.favicon,
    source: "radio"
  }));
}

app.get("/api/trending", async (req, res) => {
  try {

    const audius = await getAudius();
    const jamendo = await getJamendo();
    const archive = await getArchive();
    const pixabay = await getPixabay();
    const radio = await getRadio();

    const tracks = [
      ...audius,
      ...jamendo,
      ...archive,
      ...pixabay,
      ...radio
    ];

    res.json({ tracks });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "server error" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("AIMusic API running on port " + PORT);
});
