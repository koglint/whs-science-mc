// common.js — shared logic for question pages WITH Firestore writes (safe version)

import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("[common.js] Module loaded for", window.location.pathname);

document.addEventListener("DOMContentLoaded", () => {
  console.log("[common.js] DOMContentLoaded");

  const match = window.location.pathname.match(/q(\d+)\.html$/);
  if (!match) {
    console.warn(
      "[common.js] Could not detect qN.html from path:",
      window.location.pathname
    );
    return;
  }

  const current = parseInt(match[1], 10);
  console.log("[common.js] Detected question number:", current);

  const nextBtn = document.getElementById("nextBtn");
  const prevBtn = document.getElementById("prevBtn");
  const options = document.querySelectorAll("input[name='answer']");

  if (!nextBtn) console.warn("[common.js] nextBtn not found on page");
  if (!prevBtn) console.warn("[common.js] prevBtn not found on page");
  if (!options.length)
    console.warn("[common.js] No inputs found with name='answer'");

  // -----------------------------
  // highlight selected option
  // (same behaviour you already had)
  // -----------------------------
  options.forEach((opt) => {
    opt.addEventListener("change", () => {
      console.log("[common.js] Option changed. Selected value:", opt.value);
      options.forEach((o) => {
        if (o.parentElement) o.parentElement.style.background = "#2a2a2a";
      });
      if (opt.parentElement) opt.parentElement.style.background = "#4a90e2";
    });
  });

  // -----------------------------
  // Previous button navigation
  // (same as your TEMP version)
  // -----------------------------
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      console.log("[common.js] Prev button clicked on q" + current);
      const prev = current - 1;
      if (prev >= 1) {
        const target = `q${prev}.html`;
        console.log("[common.js] Navigating to previous:", target);
        window.location.href = target;
      } else {
        console.log("[common.js] Navigating back to ../index.html");
        window.location.href = "../index.html";
      }
    });
  }

  // -----------------------------
  // Next button: save to Firestore, THEN navigate
  // -----------------------------
  if (nextBtn) {
    nextBtn.addEventListener("click", async () => {
      console.log("[common.js] Next button clicked on q" + current);

      const selected = Array.from(options).find((o) => o.checked);
      if (!selected) {
        console.warn("[common.js] Next clicked with no option selected");
        alert("Please select an answer before moving on.");
        return;
      }

      const answerValue = selected.value;
      console.log("[common.js] Selected answer:", answerValue);

      // per-question metadata from window.questionConfig
      const qc = window.questionConfig || {};
      console.log("[common.js] window.questionConfig:", qc);

      const questionId = qc.id || `q${current}`;
      const correctAnswer =
        typeof qc.correctAnswer === "string" ? qc.correctAnswer : null;
      const outcome = qc.outcome || null;
      const topic = qc.topic || null;

      console.log("[common.js] Prepared response meta:", {
        questionId,
        correctAnswer,
        outcome,
        topic,
      });

      nextBtn.disabled = true;

      try {
        await saveResponse({
          questionId,
          answerValue,
          correctAnswer,
          outcome,
          topic,
        });

        console.log(
          "[common.js] Save successful for",
          questionId,
          "— navigating to next question"
        );
        const next = current + 1;
        const target = `q${next}.html`;
        console.log("[common.js] Navigating to:", target);
        window.location.href = target;
      } catch (err) {
        console.error("[common.js] Error saving response:", err);
        alert(
          "There was an error saving your answer. Check the console for details."
        );
        nextBtn.disabled = false;
      }
    });
  }
});

// -----------------------------
// Firestore write helper
// -----------------------------
async function saveResponse({
  questionId,
  answerValue,
  correctAnswer,
  outcome,
  topic,
}) {
  console.log("[common.js] saveResponse() called with:", {
    questionId,
    answerValue,
    correctAnswer,
    outcome,
    topic,
  });

  // IMPORTANT: dynamically import firebase-init.js here,
  // so any problems with config/fetch don't kill the whole module.
  let auth, db;
  try {
    const mod = await import("./firebase-init.js");
    auth = mod.auth;
    db = mod.db;
    console.log("[common.js] firebase-init imported OK in saveResponse");
  } catch (err) {
    console.error(
      "[common.js] Failed to import ./firebase-init.js inside saveResponse",
      err
    );
    throw err;
  }

  const user = auth.currentUser;

  if (!user) {
    console.warn(
      "[common.js] No authenticated user (auth.currentUser is null). Using 'anonymous' UID. Firestore rules may block this."
    );
  } else {
    console.log("[common.js] Current user:", user.uid, user.email);
  }

  const uid = user ? user.uid : "anonymous";
  const docId = `${uid}_${questionId}`;
  const ref = doc(db, "responses", docId);

  const isCorrect =
    correctAnswer && typeof correctAnswer === "string"
      ? answerValue === correctAnswer
      : null;

  const payload = {
    uid,
    questionId,
    answer: answerValue,
    correctAnswer: correctAnswer || null,
    isCorrect,
    outcome: outcome || null,
    topic: topic || null,
    ts: serverTimestamp(),
  };

  console.log(
    "[common.js] Writing to Firestore: collection 'responses', docId:",
    docId,
    "payload:",
    payload
  );

  await setDoc(ref, payload, { merge: true });

  console.log(
    "[common.js] Firestore setDoc completed successfully for",
    docId
  );
}
