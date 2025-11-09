import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import { Parser } from "json2csv";
import ExcelJS from "exceljs";


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



app.get("/api/export", async (req, res) => {
  try {
    const providedKey = req.query.key;
    if (providedKey !== process.env.EXPORT_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // === Fetch all documents from testCollection ===
    const snapshot = await db.collection("testCollection").get();
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (data.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    // === Create Excel workbook ===
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Test Collection");

    // Add headers
    const headers = Object.keys(data[0]);
    sheet.addRow(headers);

    // Add rows
    data.forEach(obj => {
      const row = headers.map(h => obj[h]);
      sheet.addRow(row);
    });

    // Format headers
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach(col => {
      col.width = 25;
    });

    // Write workbook to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Send as downloadable Excel file
    res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.attachment("whs-science-export.xlsx");
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

