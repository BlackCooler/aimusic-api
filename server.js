const express = require("express");
const fetch = require("node-fetch");

const app = express();

app.get("/api/trending", async (req, res) => {
    try {

        const response = await fetch("https://discoveryprovider.audius.co/v1/tracks/trending?limit=50");
        const data = await response.json();

        const tracks = data.data.map(track => ({
            id: "audius_" + track.id,
            title: track.title,
            artist: track.user.name,
            cover: track.artwork?.["480x480"] || "",
            stream: "https://discoveryprovider.audius.co/v1/tracks/" + track.id + "/stream",
            duration: track.duration,
            source: "audius"
        }));

        res.json({tracks});

    } catch (err) {
        res.status(500).json({error:"server error"});
    }
});

app.listen(3000, () => {
    console.log("AIMusic API running");
});
