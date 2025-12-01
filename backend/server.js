import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import ExcelJS from "exceljs";
import multer from "multer";
import PDFDocument from "pdfkit";


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


// ================== STUDENT REPORT HELPERS & MODEL ==================

// Basic stats helpers
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance =
    arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function percentileRank(arr, value) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  const equal = sorted.filter((v) => v === value).length;
  const rank = (below + 0.5 * equal) / sorted.length;
  return rank * 100;
}

function quartiles(arr) {
  if (!arr.length) {
    return { q1: 0, median: 0, q3: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const medianAt = (xs) => {
    const n = xs.length;
    const mid = Math.floor(n / 2);
    if (n % 2 === 0) return (xs[mid - 1] + xs[mid]) / 2;
    return xs[mid];
  };

  const median = medianAt(sorted);
  const mid = Math.floor(sorted.length / 2);
  const lower = sorted.slice(0, mid);
  const upper = sorted.length % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  const q1 = lower.length ? medianAt(lower) : median;
  const q3 = upper.length ? medianAt(upper) : median;
  return { q1, median, q3 };
}

function formatDateForReport(value) {
  if (!value) return "";
  try {
    if (value.toDate) {
      const d = value.toDate();
      return d.toISOString().slice(0, 10);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(value);
  }
}

// Build a unified responses object like in Sentral export
function buildResponsesObject(row) {
  const responsesObj = {};

  if (row.responses && typeof row.responses === "object") {
    Object.assign(responsesObj, row.responses);
  }

  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("responses.") && value && typeof value === "object") {
      const qid = key.slice("responses.".length);
      responsesObj[qid] = value;
    }
  }

  return responsesObj;
}

// Main model builder: quizId + studentEmail + sciClass
async function buildStudentReportModel({ quizId, studentEmail, sciClass }) {
  const email = studentEmail.toLowerCase().trim();
  if (!email) throw new Error("studentEmail required");

  // 1. Get this student's response for this quiz
  const studentSnap = await db
    .collection("responses")
    .where("quizId", "==", quizId)
    .where("email", "==", email)
    .limit(1)
    .get();

  if (studentSnap.empty) {
    throw new Error("No response found for this student and quiz");
  }

  const studentDoc = studentSnap.docs[0];
  const studentRow = studentDoc.data();

  const responsesObj = buildResponsesObject(studentRow);
  const questionEntries = Object.values(responsesObj);

  const outcomeKeys = ["KU", "PCE", "PS", "CM"];
  const outcomeRaw = {
    KU: { correct: 0, total: 0 },
    PCE: { correct: 0, total: 0 },
    PS: { correct: 0, total: 0 },
    CM: { correct: 0, total: 0 },
  };

  let totalQuestions = 0;
  let totalCorrect = 0;

  const topicMap = new Map(); // topicId → { id, name, correct, total }

  // Only count questions with a defined correctAnswer (like Sentral export)
  for (const q of questionEntries) {
    if (!q) continue;
    if (
      typeof q.correctAnswer !== "string" ||
      !q.correctAnswer.trim()
    ) {
      continue;
    }

    totalQuestions++;
    const isCorrect = q.isCorrect === true;
    if (isCorrect) totalCorrect++;

    const outcome = q.outcome;
    if (outcomeKeys.includes(outcome)) {
      outcomeRaw[outcome].total++;
      if (isCorrect) outcomeRaw[outcome].correct++;
    }

    const topicId = q.topicId || q.topic || null; // adjust if you store topic differently
    const topicName = q.topicName || topicId || "Topic";
    if (topicId) {
      if (!topicMap.has(topicId)) {
        topicMap.set(topicId, {
          id: topicId,
          name: topicName,
          correct: 0,
          total: 0,
        });
      }
      const t = topicMap.get(topicId);
      t.total++;
      if (isCorrect) t.correct++;
    }
  }

  const overallRaw = {
    correct: totalCorrect,
    total: totalQuestions,
  };

  const overallPercent =
    totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;

  const outcomePercentages = {};
  for (const k of outcomeKeys) {
    const o = outcomeRaw[k];
    outcomePercentages[k] =
      o.total > 0 ? (o.correct / o.total) * 100 : 0;
  }

  // 2. Class stats for this quiz + class (like Sentral export style)
  const classSnap = await db
    .collection("responses")
    .where("quizId", "==", quizId)
    .get();

  const responseDocs = classSnap.docs.map((d) => d.data());

  const emailSet = new Set();
  for (const row of responseDocs) {
    if (typeof row.email === "string" && row.email.trim()) {
      emailSet.add(row.email.toLowerCase());
    }
  }

  const classScores = [];
  let rosterForStudent = null;

  if (emailSet.size > 0) {
    const emailList = Array.from(emailSet);
    const docRefs = emailList.map((e) => db.collection("roster").doc(e));
    const rosterSnaps = await db.getAll(...docRefs);

    const rosterMap = new Map();
    rosterSnaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      rosterMap.set(emailList[idx], snap.data());
    });

    for (const row of responseDocs) {
      const rowEmail =
        typeof row.email === "string" ? row.email.toLowerCase() : "";
      if (!rowEmail) continue;

      const roster = rosterMap.get(rowEmail);
      if (!roster) continue;

      const rowSciClass = roster.sciClass || "";
      if (sciClass && rowSciClass !== sciClass) continue;

      const resObj = buildResponsesObject(row);
      const qList = Object.values(resObj).filter(
        (q) =>
          q &&
          typeof q.correctAnswer === "string" &&
          q.correctAnswer.trim() !== ""
      );

      const total = qList.length;
      if (!total) continue;
      const correct = qList.filter((q) => q.isCorrect === true).length;
      const pct = (correct / total) * 100;
      classScores.push(pct);

      if (rowEmail === email) {
        rosterForStudent = roster;
      }
    }
  }

  let classStats;
  let boxPlot;

  if (classScores.length) {
    const m = mean(classScores);
    const sd = stdDev(classScores);
    const { q1, median, q3 } = quartiles(classScores);
    const minScore = Math.min(...classScores);
    const maxScore = Math.max(...classScores);
    const studentPercentile = percentileRank(classScores, overallPercent);

    classStats = {
      min: minScore,
      max: maxScore,
      mean: m,
      stdDev: sd,
      percentile: studentPercentile,
      studentScore: overallPercent,
    };

    boxPlot = {
      min: minScore,
      q1,
      median,
      q3,
      max: maxScore,
      student: overallPercent,
    };
  } else {
    classStats = {
      min: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
      percentile: 0,
      studentScore: overallPercent,
    };
    boxPlot = {
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      student: overallPercent,
    };
  }

  // 3. Topic performance
  const topics = [];
  for (const t of topicMap.values()) {
    const percent = t.total > 0 ? (t.correct / t.total) * 100 : 0;
    let level = "Limited";
    if (percent >= 85) level = "Outstanding";
    else if (percent >= 70) level = "Thorough";
    else if (percent >= 55) level = "Sound";
    else if (percent >= 40) level = "Basic";

    topics.push({
      id: t.id,
      name: t.name,
      correct: t.correct,
      total: t.total,
      percent,
      level,
    });
  }

  topics.sort((a, b) => a.id.localeCompare(b.id));

  // 4. Strengths / weaknesses (simple rules)
  const strengthOutcomes = outcomeKeys.filter(
    (k) => outcomePercentages[k] >= 70
  );
  const weakOutcomes = outcomeKeys.filter(
    (k) => outcomePercentages[k] < 50
  );

  const strengthTopics = topics.filter((t) => t.percent >= 70);
  const weakTopics = topics.filter((t) => t.percent < 50);

  const strengthSkills = [];
  if (strengthOutcomes.includes("KU")) {
    strengthSkills.push("Strong knowledge and understanding of key ideas");
  }
  if (strengthOutcomes.includes("PS")) {
    strengthSkills.push("Good problem-solving in new situations");
  }
  if (strengthOutcomes.includes("CM")) {
    strengthSkills.push("Clear scientific communication");
  }

  const errorTypes = [];
  if (weakOutcomes.includes("KU")) {
    errorTypes.push("Gaps in core concepts and definitions (KU)");
  }
  if (weakOutcomes.includes("PS")) {
    errorTypes.push("Difficulty applying ideas in unfamiliar contexts (PS)");
  }
  if (weakOutcomes.includes("CM")) {
    errorTypes.push("Unclear or incomplete written explanations (CM)");
  }

  const priorityTopics = weakTopics
    .sort((a, b) => a.percent - b.percent)
    .map((t) => `${t.id} ${t.name}`);

  const recommendedSkills = [];
  if (weakOutcomes.includes("KU")) {
    recommendedSkills.push("Revise key definitions and summary notes");
  }
  if (weakOutcomes.includes("PS")) {
    recommendedSkills.push(
      "Practise multi-step problems that combine several ideas"
    );
  }
  if (weakOutcomes.includes("CM")) {
    recommendedSkills.push(
      "Practise writing full explanations using correct scientific terms"
    );
  }

  const summaryText = (() => {
    const lines = [];
    lines.push(
      `Overall score: ${overallPercent.toFixed(
        1
      )}%. Strongest outcomes: ${
        strengthOutcomes.length
          ? strengthOutcomes.join(", ")
          : "none clearly above the others yet"
      }.`
    );
    if (weakOutcomes.length) {
      lines.push(
        `Most important outcomes to improve: ${weakOutcomes.join(", ")}.`
      );
    }
    if (priorityTopics.length) {
      lines.push(
        `Top priority topics: ${priorityTopics.slice(0, 3).join("; ")}.`
      );
    }
    return lines.join(" ");
  })();

  // Header fields
  const header = {
    studentName: rosterForStudent
      ? `${rosterForStudent.givenName || ""} ${rosterForStudent.familyName || ""}`.trim() ||
        "Student"
      : studentRow.studentName || "Student",
    className: rosterForStudent ? rosterForStudent.sciClass || sciClass : sciClass,
    taskName: studentRow.quizName || quizId,
    dateCompleted: formatDateForReport(
      studentRow.lastUpdated || studentRow.timestamp || null
    ),
    overallPercent,
    overallGrade: (() => {
      const p = overallPercent;
      if (p >= 90) return "A";
      if (p >= 75) return "B";
      if (p >= 60) return "C";
      if (p >= 45) return "D";
      return "E";
    })(),
  };

  return {
    header,
    rawMarks: {
      overallRaw,
      outcomeRaw,
    },
    outcomes: {
      outcomePercentages,
      order: outcomeKeys,
    },
    stats: {
      classStats,
      boxPlot,
    },
    topics,
    strengths: {
      strengthOutcomes,
      strengthTopics,
      strengthSkills,
    },
    weaknesses: {
      weakOutcomes,
      weakTopics,
      errorTypes,
    },
    advice: {
      priorityTopics,
      recommendedSkills,
      personalisedNote: "",
    },
    summaryText,
  };
}

// Render PDF from the model with pdfkit
// Draw a single student's report into an existing PDFDocument
function writeStudentReportToDoc(doc, model, { startOnNewPage = false } = {}) {
  const {
    header,
    rawMarks,
    outcomes,
    stats,
    topics,
    strengths,
    weaknesses,
    advice,
    summaryText,
  } = model;

  if (startOnNewPage) {
    doc.addPage();
  }

  // HEADER
  doc.fontSize(18).text("Student Report", { align: "center" });
  doc.moveDown();

  doc.fontSize(12);
  doc.text(`Student: ${header.studentName}`);
  doc.text(`Class: ${header.className}`);
  doc.text(`Task: ${header.taskName}`);
  doc.text(`Completed: ${header.dateCompleted}`);
  doc.text(
    `Overall: ${header.overallPercent.toFixed(1)}% (${header.overallGrade})`
  );
  doc.moveDown();

  // RAW MARKS
  doc.fontSize(14).text("Raw Marks", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  const overallRaw = rawMarks.overallRaw;
  doc.text(`Overall: ${overallRaw.correct}/${overallRaw.total}`);

  const outcomeRaw = rawMarks.outcomeRaw;
  outcomes.order.forEach((k) => {
    const o = outcomeRaw[k];
    doc.text(`${k}: ${o.correct}/${o.total}`);
  });
  doc.moveDown();

  // OUTCOME BREAKDOWN
  doc.fontSize(14).text("Outcome Breakdown (%)", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  outcomes.order.forEach((k) => {
    const p = outcomes.outcomePercentages[k] || 0;
    doc.text(`${k}: ${p.toFixed(1)}%`);
  });
  doc.moveDown();

  // STATS
  doc.fontSize(14).text("Class Statistical Analysis", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  const cs = stats.classStats || {
    min: 0,
    max: 0,
    mean: 0,
    stdDev: 0,
    percentile: 0,
    studentScore: header.overallPercent,
  };

  doc.text(`Class min: ${cs.min.toFixed(1)}%`);
  doc.text(`Class max: ${cs.max.toFixed(1)}%`);
  doc.text(`Class mean: ${cs.mean.toFixed(1)}%`);
  doc.text(`Std dev: ${cs.stdDev.toFixed(2)}`);
  doc.text(
    `Your score: ${cs.studentScore.toFixed(
      1
    )}% (approx. ${cs.percentile.toFixed(1)}th percentile)`
  );
  doc.moveDown();

  // BOX & WHISKER PLOT
  const box = stats.boxPlot || {
    min: 0,
    q1: 0,
    median: 0,
    q3: 0,
    max: 0,
    student: header.overallPercent,
  };

  doc.text("Class distribution (box & whisker):");
  doc.moveDown(0.3);

  const plotX = 70;
  const plotY = doc.y + 15;
  const plotWidth = 400;
  const plotHeight = 20;

  const scale = (score) => {
    const minScore = 0;
    const maxScore = 100;
    return (
      plotX +
      ((Math.min(Math.max(score, minScore), maxScore) - minScore) /
        (maxScore - minScore)) *
        plotWidth
    );
  };

  // whisker line
  doc
    .moveTo(scale(box.min), plotY + plotHeight / 2)
    .lineTo(scale(box.max), plotY + plotHeight / 2)
    .stroke();

  // min and max ticks
  doc
    .moveTo(scale(box.min), plotY + 5)
    .lineTo(scale(box.min), plotY + plotHeight - 5)
    .stroke();
  doc
    .moveTo(scale(box.max), plotY + 5)
    .lineTo(scale(box.max), plotY + plotHeight - 5)
    .stroke();

  // box Q1–Q3
  const q1X = scale(box.q1);
  const q3X = scale(box.q3);
  doc.rect(q1X, plotY, q3X - q1X, plotHeight).stroke();

  // median
  const medX = scale(box.median);
  doc.moveTo(medX, plotY).lineTo(medX, plotY + plotHeight).stroke();

  // student marker
  const studentX = scale(box.student);
  const studentY = plotY + plotHeight / 2;
  doc.circle(studentX, studentY, 3).fill();
  doc.moveDown(3);

  // TOPIC PERFORMANCE
  doc.fontSize(14).text("Topic Performance", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  if (topics.length === 0) {
    doc.text("No topic-level data available.");
  } else {
    topics.forEach((t) => {
      doc.text(
        `${t.id} ${t.name}: ${t.percent.toFixed(1)}% (${t.level})`
      );
    });
  }
  doc.moveDown();

  // STRENGTHS
  doc.fontSize(14).text("Strengths", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  if (strengths.strengthOutcomes.length) {
    doc.text(
      `Strong outcomes: ${strengths.strengthOutcomes.join(", ")}`
    );
  }
  if (strengths.strengthTopics.length) {
    doc.text(
      `Strong topics: ${strengths.strengthTopics
        .map((t) => `${t.id} ${t.name}`)
        .join("; ")}`
    );
  }
  if (strengths.strengthSkills.length) {
    doc.text(
      `General strengths: ${strengths.strengthSkills.join("; ")}`
    );
  }
  if (
    !strengths.strengthOutcomes.length &&
    !strengths.strengthTopics.length &&
    !strengths.strengthSkills.length
  ) {
    doc.text("No clear strengths identified yet.");
  }
  doc.moveDown();

  // WEAKNESSES
  doc.fontSize(14).text("Weaknesses", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  if (weaknesses.weakOutcomes.length) {
    doc.text(
      `Outcomes needing attention: ${weaknesses.weakOutcomes.join(", ")}`
    );
  }
  if (weaknesses.weakTopics.length) {
    doc.text(
      `Topics needing attention: ${weaknesses.weakTopics
        .map((t) => `${t.id} ${t.name}`)
        .join("; ")}`
    );
  }
  if (weaknesses.errorTypes.length) {
    doc.text(`Common error patterns: ${weaknesses.errorTypes.join("; ")}`);
  }
  if (
    !weaknesses.weakOutcomes.length &&
    !weaknesses.weakTopics.length &&
    !weaknesses.errorTypes.length
  ) {
    doc.text("No specific weaknesses identified from this task.");
  }
  doc.moveDown();

  // STUDY ADVICE
  doc.fontSize(14).text("Study Advice", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(12);

  if (advice.priorityTopics.length) {
    doc.text("Priority topics to revise:");
    advice.priorityTopics.slice(0, 5).forEach((t, idx) => {
      doc.text(`${idx + 1}. ${t}`);
    });
    doc.moveDown(0.3);
  }

  if (advice.recommendedSkills.length) {
    doc.text("Recommended skill practice:");
    advice.recommendedSkills.forEach((s) => {
      doc.text(`- ${s}`);
    });
  }
  doc.moveDown();

  // SUMMARY ON NEW PAGE
  doc.addPage();
  doc.fontSize(14).text("Summary", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(summaryText, {
    align: "left",
  });
}

// Single-student PDF buffer (kept for future use if needed)
function renderStudentReportPDF(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    writeStudentReportToDoc(doc, model, { startOnNewPage: false });

    doc.end();
  });
}

// Multi-student PDF buffer for a whole class
function renderClassStudentReportsPDF(models) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    models.forEach((model, index) => {
      writeStudentReportToDoc(doc, model, {
        startOnNewPage: index !== 0,
      });
    });

    doc.end();
  });
}




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


// -------------------- ADMIN QUIZ & CLASS LISTS (ADMIN ONLY) --------------------

// GET /api/admin/quizzes  -> { quizzes: ["task1_2025", "task2_2025", ...] }
app.get("/api/admin/quizzes", requireExportAdmin, async (req, res) => {
  try {
    const snap = await db.collection("responses").select("quizId").get();
    const quizSet = new Set();

    snap.forEach((doc) => {
      const d = doc.data();
      const q = (d.quizId || "").trim();
      if (q) quizSet.add(q);
    });

    const quizzes = Array.from(quizSet).sort();
    res.json({ quizzes });
  } catch (err) {
    console.error("Quiz list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/classes?quizId=task1_2025 -> { classes: ["10SciASP", "7Sci3", ...] }
app.get("/api/admin/classes", requireExportAdmin, async (req, res) => {
  try {
    const quizId = (req.query.quizId || "").trim();
    if (!quizId) {
      return res.status(400).json({ error: "quizId is required" });
    }

    const snap = await db
      .collection("responses")
      .where("quizId", "==", quizId)
      .get();

    if (snap.empty) {
      return res.json({ classes: [] });
    }

    const responseDocs = snap.docs.map((d) => d.data());

    const emailSet = new Set();
    for (const row of responseDocs) {
      if (typeof row.email === "string" && row.email.trim()) {
        emailSet.add(row.email.toLowerCase());
      }
    }

    if (emailSet.size === 0) {
      return res.json({ classes: [] });
    }

    const emailList = Array.from(emailSet);
    const docRefs = emailList.map((e) => db.collection("roster").doc(e));
    const rosterSnaps = await db.getAll(...docRefs);

    const classSet = new Set();
    rosterSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      const sciClass = (data.sciClass || "").trim();
      if (sciClass) classSet.add(sciClass);
    });

    const classes = Array.from(classSet).sort();
    res.json({ classes });
  } catch (err) {
    console.error("Class list error:", err);
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




    // Build a unified responses object regardless of how it was stored
    const responsesObj = {};

    // Case 1: nested map like { responses: { q1: {...}, q2: {...} } }
    if (row.responses && typeof row.responses === "object") {
      Object.assign(responsesObj, row.responses);
    }

    // Case 2: flattened fields like "responses.q1", "responses.q2" on the doc
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("responses.") && value && typeof value === "object") {
        const qid = key.slice("responses.".length); // "responses.q1" -> "q1"
        responsesObj[qid] = value;
      }
    }

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



// -------------------- STUDENT REPORT PDF EXPORT (ADMIN ONLY) --------------------

// GET /api/student-report?quizId=task1_2025&studentEmail=some@email&sciClass=10SciA
app.get("/api/student-report", requireExportAdmin, async (req, res) => {
  try {
    const quizId = (req.query.quizId || "").trim();
    const studentEmail = (req.query.studentEmail || "").trim().toLowerCase();
    const sciClass = (req.query.sciClass || "").trim();

    if (!quizId || !studentEmail || !sciClass) {
      return res
        .status(400)
        .json({ error: "quizId, studentEmail and sciClass are required" });
    }

    const model = await buildStudentReportModel({
      quizId,
      studentEmail,
      sciClass,
    });

    const pdfBuffer = await renderStudentReportPDF(model);

    const safeStudentName = (model.header.studentName || "student")
      .replace(/[^a-z0-9_\-]+/gi, "_");
    const filename = `StudentReport_${safeStudentName}_${quizId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Error generating student report:", err);
    res
      .status(500)
      .json({ error: "Failed to generate student report", detail: err.message });
  }
});


// -------------------- CLASS STUDENT REPORTS PDF (ADMIN ONLY) --------------------

// GET /api/student-reports-class?quizId=task1_2025&sciClass=10SciASP
app.get("/api/student-reports-class", requireExportAdmin, async (req, res) => {
  try {
    const quizId = (req.query.quizId || "").trim();
    const sciClass = (req.query.sciClass || "").trim();

    if (!quizId || !sciClass) {
      return res
        .status(400)
        .json({ error: "quizId and sciClass are required" });
    }

    // 1) Fetch all responses for this quiz
    const snap = await db
      .collection("responses")
      .where("quizId", "==", quizId)
      .get();

    if (snap.empty) {
      return res
        .status(404)
        .json({ error: "No responses found for this quizId" });
    }

    const responseDocs = snap.docs.map((d) => d.data());

    // 2) Collect emails and join with roster
    const emailSet = new Set();
    for (const row of responseDocs) {
      if (typeof row.email === "string" && row.email.trim()) {
        emailSet.add(row.email.toLowerCase());
      }
    }

    if (emailSet.size === 0) {
      return res
        .status(400)
        .json({ error: "No emails found in responses to join with roster" });
    }

    const emailList = Array.from(emailSet);
    const docRefs = emailList.map((e) => db.collection("roster").doc(e));
    const rosterSnaps = await db.getAll(...docRefs);

    const rosterMap = new Map();
    rosterSnaps.forEach((snap, idx) => {
      if (!snap.exists) return;
      rosterMap.set(emailList[idx], snap.data());
    });

    // 3) Determine which students are in the target sciClass
    const classStudentsMap = new Map(); // email -> rosterData

    for (const row of responseDocs) {
      const rowEmail =
        typeof row.email === "string" ? row.email.toLowerCase() : "";
      if (!rowEmail) continue;

      const roster = rosterMap.get(rowEmail);
      if (!roster) continue;

      const rowSciClass = roster.sciClass || "";
      if (rowSciClass !== sciClass) continue;

      if (!classStudentsMap.has(rowEmail)) {
        classStudentsMap.set(rowEmail, roster);
      }
    }

    const classStudentEntries = Array.from(classStudentsMap.entries());
    if (classStudentEntries.length === 0) {
      return res.status(404).json({
        error: "No students found in that class for this quiz.",
      });
    }

    // Sort by surname then givenName
    classStudentEntries.sort((a, b) => {
      const rosterA = a[1];
      const rosterB = b[1];
      const surA = (rosterA.familyName || "").toLowerCase();
      const surB = (rosterB.familyName || "").toLowerCase();
      const cmpSur = surA.localeCompare(surB);
      if (cmpSur !== 0) return cmpSur;
      const givA = (rosterA.givenName || "").toLowerCase();
      const givB = (rosterB.givenName || "").toLowerCase();
      return givA.localeCompare(givB);
    });

    // 4) Build a report model for each student in the class
    const models = [];
    for (const [email, roster] of classStudentEntries) {
      try {
        const model = await buildStudentReportModel({
          quizId,
          studentEmail: email,
          sciClass,
        });
        models.push(model);
      } catch (err) {
        console.warn(
          `Skipping student ${email} for class report:`,
          err.message
        );
      }
    }

    if (!models.length) {
      return res.status(404).json({
        error:
          "No valid student reports could be generated for that class/quiz.",
      });
    }

    // 5) Render combined PDF
    const pdfBuffer = await renderClassStudentReportsPDF(models);

    const safeClass = sciClass.replace(/[^a-z0-9_\-]+/gi, "_");
    const safeQuiz = quizId.replace(/[^a-z0-9_\-]+/gi, "_");
    const filename = `StudentReports_${safeClass}_${safeQuiz}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Error generating class student reports:", err);
    res.status(500).json({
      error: "Failed to generate class student reports",
      detail: err.message,
    });
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
