import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import ExcelJS from "exceljs";
import multer from "multer";

const app = express();
app.use(cors());
app.use(express.json());

// Multer setup for file uploads (memory storage, 5 MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();


// -------------------- AUTH MIDDLEWARE --------------------

// Parse comma-separated list of admin emails from env
const exportAdmins = (process.env.EXPORT_ADMINS || "")
  .split(",")
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Middleware: require a valid Firebase ID token and admin email (for admin-only routes)
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

    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth error (export admin):", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Middleware: require *any* valid Firebase user (no admin check)
// We'll use this for /api/profile, student-side stuff.
async function requireFirebaseUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email) {
      return res.status(403).json({ error: "No email on token" });
    }

    req.user = decoded;
    next();
  } catch (err) {
    console.error("Auth error (generic user):", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}


app.get("/", (req, res) => res.send("WHSScienceMC backend online"));
app.get("/api/test", async (req, res) => {
  const collections = await db.listCollections();
  res.json({ status: "ok", collections: collections.map(c => c.id) });
});

// ✅ Serve Firebase public config to frontend
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


// -------------------- PROFILE LOOKUP (USES ROSTER) --------------------

// GET /api/profile
// Any logged-in user can call this.
// Returns roster info for the caller's email, or rosterMatched:false if not found.
app.get("/api/profile", requireFirebaseUser, async (req, res) => {
  try {
    const email = req.user.email.toLowerCase();

    const docRef = db.collection("roster").doc(email);
    const snap = await docRef.get();

    if (!snap.exists) {
      // Not found in roster
      return res.json({
        rosterMatched: false,
        email,
      });
    }

    const data = snap.data();

    res.json({
      rosterMatched: true,
      email: data.email || email,
      givenName: data.givenName || "",
      familyName: data.familyName || "",
      yearLevel: data.yearLevel || null,
      sciClass: data.sciClass || "",
    });
  } catch (err) {
    console.error("Profile lookup error:", err);
    res.status(500).json({ error: err.message });
  }
});


// -------------------- SECURE EXCEL EXPORT (ADMIN ONLY) --------------------

// Secure Excel export: only allowed admins can access
app.get("/api/export", requireExportAdmin, async (req, res) => {
  try {
    // For now default to 'responses', but allow override via ?collection=
    const collectionPath = req.query.collection || "responses";

    // Fetch all docs from the specified collection
    const snapshot = await db.collection(collectionPath).get();
    let data = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (data.length === 0) {
      return res.status(404).json({ error: "No data found" });
    }

    // --------------------------------------------------
    // NEW: join with roster when exporting 'responses'
    // --------------------------------------------------
    if (collectionPath === "responses") {
      // Gather unique emails from responses
      const emailSet = new Set();
      for (const row of data) {
        if (typeof row.email === "string" && row.email.trim()) {
          emailSet.add(row.email.toLowerCase());
        }
      }

      if (emailSet.size > 0) {
        const emailList = Array.from(emailSet);

        // Build docRefs for roster/{email}
        const docRefs = emailList.map(email =>
          db.collection("roster").doc(email)
        );

        // Fetch all roster docs in one go
        const rosterSnaps = await db.getAll(...docRefs);

        // Map email -> rosterData
        const rosterMap = new Map();
        rosterSnaps.forEach((snap, idx) => {
          if (!snap.exists) return;
          const rosterData = snap.data();
          const email = emailList[idx]; // lowercased
          rosterMap.set(email, rosterData);
        });

        // Enrich each response row with roster info, if available
        data = data.map(row => {
          const email =
            typeof row.email === "string" ? row.email.toLowerCase() : "";
          const roster = rosterMap.get(email);

          if (roster) {
            const givenName = roster.givenName || "";
            const familyName = roster.familyName || "";
            const fullName = (givenName + " " + familyName).trim();

            return {
              ...row,
              // overwrite or add these fields from roster
              email: roster.email || row.email || email,
              givenName,
              familyName,
              fullName,
              yearLevel: roster.yearLevel ?? row.yearLevel ?? null,
              sciClass: roster.sciClass || row.sciClass || "",
            };
          }

          // no roster match – leave row as-is
          return row;
        });
      }
    }

    // --------------------------------------------------
    // Build Excel from enriched data (same as before)
    // --------------------------------------------------

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






// -------------------- SENTRAL MARKBOOK EXPORT (ADMIN ONLY) --------------------

// GET /api/export-sentral?quizId=task1_2025[&sciClass=7Sci3]
app.get("/api/export-sentral", requireExportAdmin, async (req, res) => {
  try {
    const quizId = (req.query.quizId || "task1_2025").trim();
    const sciClassFilter = (req.query.sciClass || "").trim(); // optional

    if (!quizId) {
      return res.status(400).json({ error: "quizId is required" });
    }

    // 1) Fetch all responses for this quiz
    const snap = await db.collection("responses")
      .where("quizId", "==", quizId)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: "No responses found for this quizId" });
    }

    const responseDocs = snap.docs.map(d => d.data());

    // 2) Collect unique emails for roster join
    const emailSet = new Set();
    for (const row of responseDocs) {
      if (typeof row.email === "string" && row.email.trim()) {
        emailSet.add(row.email.toLowerCase());
      }
    }

    if (emailSet.size === 0) {
      return res.status(400).json({ error: "No emails found in responses to join with roster" });
    }

    const emailList = Array.from(emailSet);
    const docRefs = emailList.map(email => db.collection("roster").doc(email));
    const rosterSnaps = await db.getAll(...docRefs);

    const rosterMap = new Map();
    rosterSnaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      const emailKey = emailList[idx]; // already lowercased
      rosterMap.set(emailKey, snap.data());
    });

    // 3) Build rows for Sentral
    const rows = [];
    let skippedNoRoster = 0;
    let skippedClassFilter = 0;

    for (const row of responseDocs) {
      const email = (row.email || "").toLowerCase();
      if (!email) continue;

      const roster = rosterMap.get(email);
      if (!roster || !roster.studentCode) {
        skippedNoRoster++;
        continue; // we don't want rows with no student code
      }

      const sciClass = roster.sciClass || "";
      if (sciClassFilter && sciClass !== sciClassFilter) {
        skippedClassFilter++;
        continue;
      }

      const responsesObj = row.responses || {};
      const questionEntries = Object.values(responsesObj);

      // helper to compute integer percentage (0–100) or null
      const percentOf = (subset) => {
        const total = subset.length;
        if (!total) return null;
        const correct = subset.filter(q => q && q.isCorrect === true).length;
        return Math.round((correct * 100) / total);
      };

      // Overall: only questions with a defined correctAnswer
      const overallQuestions = questionEntries.filter(q =>
        q && typeof q.correctAnswer === "string" && q.correctAnswer.trim() !== ""
      );
      const overallPct = percentOf(overallQuestions);

      // Outcome-specific
      const kuQs = questionEntries.filter(q => q && q.outcome === "KU");
      const pceQs = questionEntries.filter(q => q && q.outcome === "PCE");
      const psQs = questionEntries.filter(q => q && q.outcome === "PS");
      const cmQs = questionEntries.filter(q => q && q.outcome === "CM");

      const kuPct = percentOf(kuQs);
      const pcePct = percentOf(pceQs);
      const psPct = percentOf(psQs);
      const cmPct = percentOf(cmQs);

      rows.push({
        studentCode: roster.studentCode || "",
        firstName: roster.givenName || "",
        surname: roster.familyName || "",
        t1Overall: overallPct,
        t1KU: kuPct,
        t1PCE: pcePct,
        t1PS: psPct,
        t1CM: cmPct,
      });
    }

    if (rows.length === 0) {
      return res.status(404).json({
        error: "No rows to export after roster join / class filter",
        skippedNoRoster,
        skippedClassFilter,
      });
    }

    // 4) Sort rows by surname, then first name
    rows.sort((a, b) => {
      const sComp = (a.surname || "").localeCompare(b.surname || "", "en", { sensitivity: "base" });
      if (sComp !== 0) return sComp;
      return (a.firstName || "").localeCompare(b.firstName || "", "en", { sensitivity: "base" });
    });

    // 5) Build Excel with fixed header order
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sentral T1");

    const headers = [
      "Student Code",
      "Student First Name",
      "Student Surname",
      "T1 Overall %",
      "T1 KU %",
      "T1 PCE %",
      "T1 PS %",
      "T1 CM %",
    ];
    sheet.addRow(headers);

    for (const r of rows) {
      sheet.addRow([
        r.studentCode || "",
        r.firstName || "",
        r.surname || "",
        r.t1Overall != null ? r.t1Overall : "",
        r.t1KU != null ? r.t1KU : "",
        r.t1PCE != null ? r.t1PCE : "",
        r.t1PS != null ? r.t1PS : "",
        r.t1CM != null ? r.t1CM : "",
      ]);
    }

    // Some simple column widths
    sheet.columns = [
      { width: 15 },
      { width: 18 },
      { width: 18 },
      { width: 12 },
      { width: 10 },
      { width: 12 },
      { width: 10 },
      { width: 10 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();

    const safeClassPart = sciClassFilter ? `_class-${sciClassFilter}` : "_all-classes";
    const fileName = `sentral_T1_${quizId}${safeClassPart}.xlsx`;

    res.header("Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.attachment(fileName);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Sentral export error:", err);
    res.status(500).json({ error: err.message });
  }
});







// -------------------- ROSTER UPLOAD (XLS/XLSX, ADMIN ONLY) --------------------

// POST /api/roster-upload
// Protected by requireExportAdmin (same as export)
// Accepts multipart/form-data with field "file" (the .xls/.xlsx)
// Expects headers: email, givenName, familyName, yearLevel, sciClass
app.post(
  "/api/roster-upload",
  requireExportAdmin,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheet = workbook.worksheets[0];

      if (!sheet) {
        return res.status(400).json({ error: "No worksheet found in file" });
      }

      // Map headers -> column indices
      const headerRow = sheet.getRow(1);
      const headerMap = {};
      headerRow.eachCell((cell, colNumber) => {
        const raw = cell.value;
        const text =
          typeof raw === "string"
            ? raw
            : raw && raw.text
            ? raw.text
            : String(raw || "");
        const key = text.trim();
        if (key) headerMap[key] = colNumber;
      });

      const requiredHeaders = [
        "studentCode",
        "email",
        "givenName",
        "familyName",
        "yearLevel",
        "sciClass",
      ];
      const missing = requiredHeaders.filter(h => !headerMap[h]);
      if (missing.length > 0) {
        return res.status(400).json({
          error: "Missing required header(s)",
          missing,
        });
      }

      let processed = 0;
      let skipped = 0;

      // Firestore batch write, commit every ~400 to stay under limits
      let batch = db.batch();
      let batchCount = 0;
      const MAX_BATCH = 400;

      const lastRow = sheet.actualRowCount;

      for (let rowNum = 2; rowNum <= lastRow; rowNum++) {
        const row = sheet.getRow(rowNum);
        // Skip completely empty rows
        if (row.values.every(v => v === null || v === "")) {
          continue;
        }

        const getVal = (headerName) => {
          const col = headerMap[headerName];
          const cell = row.getCell(col).value;
          if (cell == null) return "";
          if (typeof cell === "string") return cell.trim();
          if (typeof cell === "number") return String(cell);
          if (cell && typeof cell.text === "string") return cell.text.trim();
          return String(cell).trim();
        };

        const studentCode = getVal("studentCode");


        const emailRaw = getVal("email");
        if (!emailRaw) {
          skipped++;
          continue;
        }
        const email = emailRaw.toLowerCase();

        const givenName = getVal("givenName");
        const familyName = getVal("familyName");
        const yearLevelRaw = getVal("yearLevel");
        const sciClass = getVal("sciClass");

        const yearLevelNum = parseInt(yearLevelRaw, 10);
        if (!email || Number.isNaN(yearLevelNum) || !sciClass) {
          skipped++;
          continue;
        }

        const docRef = db.collection("roster").doc(email);
        batch.set(
          docRef,
          {
            studentCode,
            email,
            givenName,
            familyName,
            yearLevel: yearLevelNum,
            sciClass,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        batchCount++;
        processed++;

        if (batchCount >= MAX_BATCH) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      res.json({
        status: "ok",
        processed,
        skipped,
      });
    } catch (err) {
      console.error("Roster upload error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
