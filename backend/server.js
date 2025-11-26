import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import ExcelJS from "exceljs";


const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();


// -------------------- EXPORT AUTH MIDDLEWARE --------------------

// Parse comma-separated list of admin emails from env
const exportAdmins = (process.env.EXPORT_ADMINS || "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Middleware: require a valid Firebase ID token and admin email
async function requireExportAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    // Verify token with Firebase Admin
    const decoded = await admin.auth().verifyIdToken(token);

    const email = (decoded.email || "").toLowerCase();
    if (!email) {
      return res.status(403).json({ error: "No email on token" });
    }

    if (!exportAdmins.includes(email)) {
      return res.status(403).json({ error: "Not authorised for export" });
    }

    // Attach user info if needed later
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}


app.get("/", (req, res) => res.send("WHSScienceMC backend online"));
app.get("/api/test", async (req, res) => {
  const collections = await db.listCollections();
  res.json({ status: "ok", collections: collections.map(c => c.id) });
});

// ✅ NEW: Serve Firebase public config to frontend
app.get("/api/config", (req, res) => {
  res.json({
    apiKey: process.env.PUBLIC_FIREBASE_APIKEY,
    authDomain: process.env.PUBLIC_FIREBASE_AUTHDOMAIN,
    projectId: process.env.PUBLIC_FIREBASE_PROJECTID,
    storageBucket: process.env.PUBLIC_FIREBASE_STORAGEBUCKET,
    messagingSenderId: process.env.PUBLIC_FIREBASE_MSGSENDER,
    appId: process.env.PUBLIC_FIREBASE_APPID
  });
});



// Secure Excel export: only allowed admins can access
app.get("/api/export", requireExportAdmin, async (req, res) => {
  try {
    // For now default to 'responses', but allow override via ?collection=
    const collectionPath = req.query.collection || "responses";

    // Fetch all docs from the specified collection
    const snapshot = await db.collection(collectionPath).get();
    const data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (data.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    // Build Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Export");

    // Collect all keys across all docs so every field gets a column
    const allKeys = new Set();
    for (const row of data) {
      Object.keys(row).forEach(k => allKeys.add(k));
    }
    const headers = Array.from(allKeys);

    // Header row
    sheet.addRow(headers);

    // Data rows
    for (const row of data) {
      const rowValues = headers.map(h => {
        const value = row[h];
        if (value === undefined) return "";
        if (value instanceof Date) return value;
        if (typeof value === "object" && value !== null) {
          return JSON.stringify(value); // flatten nested stuff
        }
        return value;
      });
      sheet.addRow(rowValues);
    }

    // Simple formatting
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };

    sheet.columns.forEach(col => {
      const lengths = col.values
        .filter(v => v != null)
        .map(v => String(v).length);
      const maxLen = lengths.length ? Math.max(...lengths) : 10;
      col.width = Math.min(40, Math.max(10, maxLen + 2));
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.header(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.attachment(`${collectionPath}-export.xlsx`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));

