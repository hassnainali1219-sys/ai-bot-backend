import { MongoClient } from "mongodb";

let cachedClient = null;

async function getDB() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI);
    await cachedClient.connect();
  }
  return cachedClient.db("bot_demo");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  try {
    const { content } = req.body;
    if (!content)
      return res.status(400).json({ error: "Content missing" });

    const db = await getDB();
    await db.collection("settings").updateOne(
      { type: "bot_instruction" },
      { $set: { content } },
      { upsert: true }
    );

    res.json({ message: "Bot trained successfully" });

  } catch (err) {
    console.error("TRAIN ERROR:", err);
    res.status(500).json({ error: "Training failed" });
  }
}
