const express = require("express")
const fetch = require("node-fetch")

const app = express()

function normalize(track){
  return {
    id: track.id || "",
    title: track.title || track.name || "Unknown",
    artist: track.artist || track.creator || "Unknown",
    stream: track.stream || "",
    cover: track.cover || "",
    source: track.source || "unknown"
  }
}

async function audius(){

  const r = await fetch(
    "https://discoveryprovider.audius.co/v1/tracks/trending?limit=100"
  )

  const j = await r.json()

  return j.data.map(t => normalize({
    id: "audius_" + t.id,
    title: t.title,
    artist: t.user.name,
    stream: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
    cover: t.artwork ? t.artwork["480x480"] : "",
    source: "audius"
  }))

}

async function jamendo(){

  const r = await fetch(
    "https://api.jamendo.com/v3.0/tracks/?client_id=demo&limit=100"
  )

  const j = await r.json()

  return j.results.map(t => normalize({
    id: "jamendo_" + t.id,
    title: t.name,
    artist: t.artist_name,
    stream: t.audio,
    cover: t.album_image,
    source: "jamendo"
  }))

}

async function archive(){

  const r = await fetch(
    "https://archive.org/advancedsearch.php?q=subject:music AND mediatype:audio&rows=100&output=json"
  )

  const j = await r.json()

  return j.response.docs.map(t => normalize({
    id: "archive_" + t.identifier,
    title: t.title,
    artist: t.creator,
    stream: `https://archive.org/download/${t.identifier}`,
    cover: "",
    source: "archive"
  }))

}

async function pixabay(){

  const r = await fetch(
    "https://pixabay.com/api/music/?key=31269580-7c7a2c2e1a1c7a7d4e9bfa3e8"
  )

  const j = await r.json()

  return j.hits.map(t => normalize({
    id: "pixabay_" + t.id,
    title: t.tags,
    artist: t.user,
    stream: t.audio,
    cover: "",
    source: "pixabay"
  }))

}

async function radio(){

  const r = await fetch(
    "https://de1.api.radio-browser.info/json/stations/bytag/music"
  )

  const j = await r.json()

  return j.slice(0,100).map(t => normalize({
    id: "radio_" + t.stationuuid,
    title: t.name,
    artist: t.country,
    stream: t.url,
    cover: t.favicon,
    source: "radio"
  }))

}

app.get("/api/trending", async (req,res)=>{

  try{

    const results = await Promise.all([
      audius(),
      jamendo(),
      archive(),
      pixabay(),
      radio()
    ])

    const tracks = results.flat()

    res.json({tracks})

  }catch(e){

    console.log(e)

    res.status(500).json({
      error:"server error"
    })

  }

})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("AIMusic API running")
})
