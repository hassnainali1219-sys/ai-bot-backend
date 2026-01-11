require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { MongoClient } = require("mongodb");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

/* =========================
   Middleware
========================= */
app.use(cors());
app.use(express.json());

/* =========================
   Helper: Age Calculation
========================= */
function calculateAge() {
  const birthYear = 2002;
  const birthMonth = 5; // June (0-based)
  const today = new Date();

  let age = today.getFullYear() - birthYear;
  if (today.getMonth() < birthMonth) age--;

  return age;
}

/* =========================
   MongoDB Setup
========================= */
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

/* =========================
   Google Gemini Setup
========================= */
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* =========================
   Health Check (IMPORTANT)
========================= */
app.get("/api/health", (req, res) => {
  res.json({ status: "OK" });
});

/* =========================
   1. Train with TXT
========================= */
app.post("/api/train-txt", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "File missing" });
    }

    const extractedText = req.file.buffer.toString("utf-8");

    const db = await connectDB();
    await db
      .collection("settings")
      .updateOne(
        { type: "bot_instruction" },
        { $set: { content: extractedText } },
        { upsert: true }
      );

    res.json({ message: "Bot trained successfully!" });
  } catch (err) {
    console.error("TRAIN ERROR:", err);
    res.status(500).json({ error: "Training failed" });
  }
});

/* =========================
   2. Chat API
========================= */
app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage, conversation = [] } = req.body;

    if (!userMessage) {
      return res.status(400).json({ error: "userMessage is required" });
    }

    const lowerMsg = userMessage.toLowerCase();

    // Special hard-coded answer
    if (lowerMsg.includes("age") && lowerMsg.includes("hassnain")) {
      const age = calculateAge();
      const year = new Date().getFullYear();
      return res.json({
        reply: `${age} years old in ${year} (born June 2002)`,
      });
    }

    // Load base prompt from DB
    const db = await connectDB();
    const config = await db
      .collection("settings")
      .findOne({ type: "bot_instruction" });

    const basePrompt = config?.content || "You are a helpful AI assistant.";

    const conversationText = conversation
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const fullPrompt = `
${basePrompt}

Conversation so far:
${conversationText}

User: ${userMessage}
Assistant:
`;

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
    });

    let reply = "No reply from AI";

    if (
      response &&
      response.candidates &&
      response.candidates.length > 0 &&
      response.candidates[0].content &&
      response.candidates[0].content.parts &&
      response.candidates[0].content.parts.length > 0
    ) {
      reply = response.candidates[0].content.parts[0].text || reply;
    }

    res.json({ reply });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

/* =========================
   IMPORTANT FOR VERCEL
========================= */
/**
 * ❌ DO NOT use app.listen()
 * ✅ Export app for Vercel serverless
 */
module.exports = app;
