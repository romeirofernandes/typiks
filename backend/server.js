const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")
const connectDB = require("./config/db")

dotenv.config()

const PORT = process.env.PORT

const app = express()

connectDB()

app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173"
}))
app.use(express.json())

app.get("/", (req, res)=> {
    res.status(200).json({
        "msg": "Typiks backend running!"
    })
})

app.listen(PORT, ()=>{
    console.log(`Server started successfully at http://localhost:${PORT}`)
})
