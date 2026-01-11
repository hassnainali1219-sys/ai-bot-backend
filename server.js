require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { MongoClient } = require("mongodb");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

/* ---------------- AGE FUNCTION ---------------- */
function calculateAge() {
  const birthYear = 2002;
  const birthMonth = 5; // June (0-based)
  const today = new Date();

  let age = today.getFullYear() - birthYear;
  if (today.getMonth() < birthMonth) age--;

  return age;
}

/* ---------------- MONGODB ---------------- */
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db("bot_demo");
    console.log("✅ MongoDB Connected");
  }
  return db;
}

/* ---------------- GEMINI ---------------- */
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* ---------------- HEALTH CHECK ---------------- */
app.get("/api/health", (req, res) => {
  res.json({ status: "OK" });
});

/* ---------------- TRAIN TXT ---------------- */
app.post("/api/train-txt", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File missing" });
    }

    const text = req.file.buffer.toString("utf-8");
    const database = await connectDB();

    await database.collection("settings").updateOne(
      { type: "bot_instruction" },
      { $set: { content: text } },
      { upsert: true }
    );

    res.json({ message: "Bot trained successfully!" });
  } catch (err) {
    console.error("TRAIN ERROR:", err);
    res.status(500).json({ error: "Training failed" });
  }
});

/* ---------------- CHAT ---------------- */
app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage, conversation = [] } = req.body;

    if (!userMessage) {
      return res.status(400).json({ error: "Message missing" });
    }

    const lowerMsg = userMessage.toLowerCase();

    /* ---- SPECIAL QUESTION ---- */
    if (lowerMsg.includes("age") && lowerMsg.includes("hassnain")) {
      const age = calculateAge();
      const year = new Date().getFullYear();
      return res.json({
        reply: `${age} years old in ${year} (born June 2002)`,
      });
    }

    const database = await connectDB();
    const config = await database
      .collection("settings")
      .findOne({ type: "bot_instruction" });

    const basePrompt =
      config?.content || "You are a helpful AI assistant.";

    const history = conversation
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `${basePrompt}\n${history}\nUser: ${userMessage}\nAssistant:`;

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const reply =
      response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response from AI";

    res.json({ reply });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

/* ---------------- EXPORT FOR VERCEL ---------------- */
module.exports = app;
