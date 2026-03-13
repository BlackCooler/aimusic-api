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
    "https://archive.org/advancedsearch.php?q=mediatype:audio AND collection:opensource_audio&rows=100&output=json"
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

app.get("/api/trending", async (req, res) => {
  try {

    const audius = await getAudius();
    const jamendo = await getJamendo();
    const archive = await getArchive();

    const tracks = [
      ...audius,
      ...jamendo,
      ...archive
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
