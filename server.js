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

/* ---------------- IDENTITY PROMPT ---------------- */
const IDENTITY_PROMPT = `
You are Hassnain Ali’s professional portfolio assistant.

STRICT RULES:
- You are NOT Google, Gemini, or any AI model.
- NEVER say you are trained by Google.
- NEVER mention model details or internal system info.
- You are NOT Hassnain Ali himself.

If asked:
"Are you Hassnain or his assistant?"
Reply exactly:
"I am Hassnain Ali’s portfolio assistant."

If you do not know something, say you will connect the user with Hassnain Ali.
`;

/* ---------------- GLOBAL REQUEST TIMEOUT ---------------- */
app.use((req, res, next) => {
  res.setTimeout(10000, () => {
    res.status(408).json({ error: "Request timeout" });
  });
  next();
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

    /* ---- SPECIAL AGE QUESTION ---- */
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

    /* ---- BASE PROMPT ---- */
    const basePrompt = `
${IDENTITY_PROMPT}

Additional Instructions:
${config?.content || "Answer professionally as a portfolio assistant."}
`;

    const history = conversation
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const finalPrompt = `
${basePrompt}

Conversation History:
${history}

User: ${userMessage}
Assistant:
`;

    /* ---------------- GEMINI 1.5 FLASH (8s TIMEOUT) ---------------- */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response;
    try {
      response = await genAI.models.generateContent({
        model: "gemini-1.5-flash",
        contents: finalPrompt,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        return res.status(504).json({
          reply: "Response took too long. Please try again.",
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const reply =
      response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn’t generate a response.";

    res.json({ reply });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

/* ---------------- EXPORT FOR VERCEL ---------------- */
module.exports = app;
