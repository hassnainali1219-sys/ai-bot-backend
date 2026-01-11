import { MongoClient } from "mongodb";
import { GoogleGenAI } from "@google/genai";

/* ---------------- AGE FUNCTION ---------------- */
function calculateAge() {
  const birthYear = 2002;
  const birthMonth = 5; // June (0-based)
  const today = new Date();

  let age = today.getFullYear() - birthYear;
  if (today.getMonth() < birthMonth) age--;

  return age;
}

/* ---------------- IDENTITY PROMPT ---------------- */
const IDENTITY_PROMPT = `
You are Hassnain Ali’s professional portfolio assistant.

STRICT RULES:
- You are NOT Google, Gemini, or any AI model.
- NEVER say you are trained by Google.
- You are NOT Hassnain Ali himself.

If asked:
"I am Hassnain Ali’s portfolio assistant."

If you do not know something, say you will connect the user with Hassnain Ali.
`;

/* ---------------- MONGODB (SERVERLESS SAFE) ---------------- */
let cachedClient = null;

async function getDB() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
  }
  return cachedClient.db("bot_demo");
}

/* ---------------- GEMINI ---------------- */
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* ---------------- HANDLER ---------------- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  try {
    const { userMessage, conversation = [] } = req.body;
    if (!userMessage)
      return res.status(400).json({ error: "Message missing" });

    const lowerMsg = userMessage.toLowerCase();

    // AGE QUESTION
    if (lowerMsg.includes("age") && lowerMsg.includes("hassnain")) {
      const age = calculateAge();
      return res.json({
        reply: `${age} years old (born June 2002)`
      });
    }

    const db = await getDB();
    const config = await db
      .collection("settings")
      .findOne({ type: "bot_instruction" });

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

    const response = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: finalPrompt,
    });

    const reply =
      response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn’t generate a response.";

    return res.json({ reply });

  } catch (err) {
    console.error("CHAT ERROR:", err);
    return res.status(500).json({ error: "Chat failed" });
  }
}
