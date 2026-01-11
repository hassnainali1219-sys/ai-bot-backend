require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { MongoClient } = require("mongodb");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// ----------------- Age Calculation -----------------
function calculateAge() {
  const birthYear = 2002;
  const birthMonth = 5; // June (0-based)
  const today = new Date();

  let age = today.getFullYear() - birthYear;
  if (today.getMonth() < birthMonth) age--;

  return age;
}

app.use(cors());
app.use(express.json());

// ----------------- MongoDB Setup -----------------
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

// ----------------- Google AI Client -----------------
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ----------------- 1. Train API -----------------
app.post("/api/train-txt", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File missing" });

    const extractedText = req.file.buffer.toString("utf-8");

    const db = await connectDB();
    await db
      .collection("settings")
      .updateOne(
        { type: "bot_instruction" },
        { $set: { content: extractedText } },
        { upsert: true }
      );

    console.log("✅ Bot instructions saved to DB");
    res.json({ message: "Bot trained successfully!" });
  } catch (e) {
    console.error("!!! TRAIN ERROR !!!", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ----------------- 2. Chat API -----------------
app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage, conversation = [] } = req.body;

    const lowerMsg = userMessage.toLowerCase();

    // --------- Handle special questions (age, etc.) first ---------
   if (lowerMsg.includes("age") && lowerMsg.includes("hassnain")) {
  const age = calculateAge();
  const currentYear = new Date().getFullYear(); // get current year dynamically
  return res.json({
    reply: `${age} years old in ${currentYear} (born June 2002)`,
  });
}


    // Connect DB and get base prompt
    const db = await connectDB();
    const config = await db
      .collection("settings")
      .findOne({ type: "bot_instruction" });
    const basePrompt = config?.content || "You are a helpful AI assistant.";

    // Convert conversation to text
    const conversationText = conversation
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const fullPrompt = `${basePrompt}\nConversation so far:\n${conversationText}\nUser: ${userMessage}\nAssistant:`;

    // Gemini API call
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
    });

    // Extract AI response safely
    let text = "No reply from AI";
    if (response?.candidates?.length > 0) {
      const candidate = response.candidates[0];
      const parts = candidate.content?.parts;
      if (parts?.length > 0) {
        text = parts[0].text || text;
      }
    }

    console.log("🤖 Bot Answered Successfully:", text);
    res.json({ reply: text });
  } catch (e) {
    console.error("!!! CHAT ERROR !!!", e.message);
    res.status(500).json({ error: "Something went wrong. Check server logs." });
  }
});

// ----------------- Optional: List Models -----------------
async function listModels() {
  try {
    const models = await genAI.models.list();
    console.log("Available Models:", models);
  } catch (e) {
    console.error("Error listing models:", e.message);
  }
}
// listModels(); // Uncomment if needed

// ----------------- Start Server -----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
