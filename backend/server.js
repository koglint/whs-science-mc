import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

app.get("/", (req, res) => res.send("WHSScienceMC backend online"));
app.get("/api/test", async (req, res) => {
  const collections = await db.listCollections();
  res.json({ status: "ok", collections: collections.map(c => c.id) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
