const express = require("express")
const fetch = require("node-fetch")

const app = express()

async function getAudius(){
  try{
    const r = await fetch("https://discoveryprovider.audius.co/v1/tracks/trending?limit=20")
    const j = await r.json()

    return j.data.map(t => ({
      id:"audius_"+t.id,
      title:t.title,
      artist:t.user.name,
      stream:`https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream`,
      cover:t.artwork ? t.artwork["480x480"] : "",
      source:"audius"
    }))
  }catch(e){
    console.log("audius error")
    return []
  }
}

async function getArchive(){
  try{
    const r = await fetch("https://archive.org/advancedsearch.php?q=subject:music AND mediatype:audio&rows=20&output=json")
    const j = await r.json()

    return j.response.docs.map(t => ({
      id:"archive_"+t.identifier,
      title:t.title || "Unknown",
      artist:t.creator || "Unknown",
      stream:`https://archive.org/download/${t.identifier}`,
      cover:"",
      source:"archive"
    }))
  }catch(e){
    console.log("archive error")
    return []
  }
}

app.get("/api/trending", async (req,res)=>{

  try{

    const audius = await getAudius()
    const archive = await getArchive()

    const tracks = [
      ...audius,
      ...archive
    ]

    res.json({tracks})

  }catch(e){

    res.json({tracks:[]})

  }

})

app.get("/",(req,res)=>{
  res.send("AIMusic API working")
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
  console.log("AIMusic API started")
})
