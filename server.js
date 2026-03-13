const express = require("express");
const fetch = require("node-fetch");

const app = express();

app.get("/api/trending", async (req, res) => {
  try {

    // ===== Audius =====
    const audiusRes = await fetch(
      "https://discoveryprovider.audius.co/v1/tracks/trending?limit=20"
    );
    const audiusData = await audiusRes.json();

    const audiusTracks = audiusData.data.map(t => ({
      id: "audius_" + t.id,
      title: t.title,
      artist: t.user.name,
      stream: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
      cover: t.artwork ? t.artwork["480x480"] : "",
      source: "audius"
    }));


    // ===== Jamendo =====
    const jamendoRes = await fetch(
      "https://api.jamendo.com/v3.0/tracks/?client_id=demo&limit=20"
    );
    const jamendoData = await jamendoRes.json();

    const jamendoTracks = jamendoData.results.map(t => ({
      id: "jamendo_" + t.id,
      title: t.name,
      artist: t.artist_name,
      stream: t.audio,
      cover: t.album_image,
      source: "jamendo"
    }));


    // ===== Archive =====
    const archiveRes = await fetch(
      "https://archive.org/advancedsearch.php?q=mediatype:audio&rows=20&output=json"
    );
    const archiveData = await archiveRes.json();

    const archiveTracks = archiveData.response.docs.map(t => ({
      id: "archive_" + t.identifier,
      title: t.title || "Unknown",
      artist: t.creator || "Unknown",
      stream: `https://archive.org/download/${t.identifier}`,
      cover: "",
      source: "archive"
    }));


    // ===== Объединяем =====
    const tracks = [
      ...audiusTracks,
      ...jamendoTracks,
      ...archiveTracks
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
