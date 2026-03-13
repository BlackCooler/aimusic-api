const express = require("express")
const fetch = require("node-fetch")

const app = express()

async function safeFetch(fn){
  try{
    return await fn()
  }catch(e){
    console.log("source error:", e.message)
    return []
  }
}

async function audius(){
  const r = await fetch(
    "https://discoveryprovider.audius.co/v1/tracks/trending?limit=50"
  )
  const j = await r.json()

  return j.data.map(t => ({
    id: "audius_"+t.id,
    title: t.title,
    artist: t.user.name,
    stream:`https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
    cover: t.artwork ? t.artwork["480x480"] : "",
    source:"audius"
  }))
}

async function jamendo(){
  const r = await fetch(
    "https://api.jamendo.com/v3.0/tracks/?client_id=demo&limit=50"
  )
  const j = await r.json()

  return j.results.map(t => ({
    id:"jamendo_"+t.id,
    title:t.name,
    artist:t.artist_name,
    stream:t.audio,
    cover:t.album_image,
    source:"jamendo"
  }))
}

async function archive(){
  const r = await fetch(
    "https://archive.org/advancedsearch.php?q=subject:music AND mediatype:audio&rows=50&output=json"
  )
  const j = await r.json()

  return j.response.docs.map(t => ({
    id:"archive_"+t.identifier,
    title:t.title || "Unknown",
    artist:t.creator || "Unknown",
    stream:`https://archive.org/download/${t.identifier}`,
    cover:"",
    source:"archive"
  }))
}

app.get("/api/trending", async (req,res)=>{

  const audiusTracks = await safeFetch(audius)
  const jamendoTracks = await safeFetch(jamendo)
  const archiveTracks = await safeFetch(archive)

  const tracks = [
    ...audiusTracks,
    ...jamendoTracks,
    ...archiveTracks
  ]

  res.json({tracks})

})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("AIMusic API running")
})
