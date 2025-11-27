// quiz.js — single-page quiz renderer using question data + Firestore

// -----------------------------
// Imports (ES module)
// -----------------------------

import { auth, db } from "./firebase-init.js";
import {
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

console.log("[quiz.js] module loaded");

// -----------------------------
// Question data
// -----------------------------

import { QUESTIONS } from "./questions-task1.js";

function applyDefinitionsToText(text, terms = []) {
  if (!terms || terms.length === 0) {
    return text;
  }

  let result = text;

  for (const { word, definition } of terms) {
    if (!word || !definition) continue;

    // Escape word for regex
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedWord}\\b`, "g");

    const safeDefinition = definition.replace(/"/g, "&quot;");

    result = result.replace(
      regex,
      `<span class="def-term" data-definition="${safeDefinition}">${word}</span>`
    );
  }

  return result;
}


// -----------------------------
// DOM references
// -----------------------------

const els = {
  loggedInUser: document.getElementById("loggedInUser"),
  rewordBtn: document.getElementById("rewordBtn"),
  questionTitle: document.getElementById("questionTitle"),
  questionBody: document.getElementById("questionBody"),
  optionsContainer: document.getElementById("optionsContainer"),
  homeBtn: document.getElementById("homeBtn"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
};

console.log("[quiz.js] initial els:", els);

let currentIndex = 0;

// -----------------------------
// Auth helper
// -----------------------------

let authInitPromise = null;

function ensureAuthAndDbWithUser() {
  if (!authInitPromise) {
    authInitPromise = new Promise((resolve) => {
      onAuthStateChanged(auth, (user) => {
        console.log(
          "[quiz.js] onAuthStateChanged. User:",
          user ? user.email : null
        );
        resolve({ auth, db, user });
      });
    });
  }
  return authInitPromise;
}

// -----------------------------
// Firestore write helper
// -----------------------------

async function saveResponse({ question, answerValue }) {
  const { user } = await ensureAuthAndDbWithUser();

  if (!user) {
    console.error(
      "[quiz.js] No authenticated user on quiz page. Aborting save."
    );
    throw new Error("Not signed in on this page - cannot save response.");
  }

  console.log("[quiz.js] Using user:", user.uid, user.email);

  const uid = user.uid;
  const quizId = "task1_2025";
  const docId = `${uid}`;

  const isCorrect =
    question.correctAnswer && typeof question.correctAnswer === "string"
      ? answerValue === question.correctAnswer
      : null;

  const responseForThisQuestion = {
    answer: answerValue,
    correctAnswer: question.correctAnswer || null,
    isCorrect,
    outcome: question.outcome || null,
    topic: question.topic || null,
    gradeLevel: question.gradeLevel || null,   // << NEW
    ts: serverTimestamp(),
  };

  const ref = doc(db, "responses", docId);

  const payload = {
    uid,
    email: user.email,
    quizId,
    [`responses.${question.id}`]: responseForThisQuestion,
    lastUpdated: serverTimestamp(),
  };

  console.log(
    "[quiz.js] Writing to Firestore: collection 'responses', docId:",
    docId,
    "payload:",
    payload
  );

  await setDoc(ref, payload, { merge: true });

  console.log(
    "[quiz.js] Firestore setDoc (merged) successfully for",
    docId,
    "question",
    question.id
  );
}

// -----------------------------
// Rendering helpers
// -----------------------------

function renderQuestion(index) {
  const question = QUESTIONS[index];
  if (!question) {
    console.error("[quiz.js] No question at index", index);
    return;
  }

  currentIndex = index;

  const questionNumber = index + 1;
  if (els.questionTitle) {
    els.questionTitle.textContent = `Question ${questionNumber}`;
  } else {
    console.warn("[quiz.js] questionTitle element is null");
  }

  console.log("[quiz.js] Rendering question index", index, "id", question.id);

  renderQuestionBody(question);
  renderOptions(question);
  updateNavButtons();
}

function renderQuestionBody(question) {
  if (!els.questionBody) {
    console.error("[quiz.js] questionBody element is null");
    return;
  }

  els.questionBody.innerHTML = "";

  question.blocks.forEach((block) => {
    let el;

    switch (block.type) {
        case "paragraph": {
        el = document.createElement("div");
        el.classList.add("info-block");
        const html = applyDefinitionsToText(block.text, question.terms);
        el.innerHTML = html;
        break;
        }


        case "question": {
        el = document.createElement("div");
        el.classList.add("main-question-block");
        const span = document.createElement("span");
        span.classList.add("info-highlight");
        const html = applyDefinitionsToText(block.text, question.terms);
        span.innerHTML = html;
        el.appendChild(span);
        break;
        }





      case "image": {
        el = document.createElement("div");
        el.classList.add("info-block");
        const img = document.createElement("img");
        img.src = block.src;
        img.alt = block.alt || "";
        el.appendChild(img);
        break;
      }

      default: {
        console.warn("[quiz.js] Unknown block type:", block.type);
        return;
      }
    }

    els.questionBody.appendChild(el);
  });
}

function renderOptions(question) {
  if (!els.optionsContainer) {
    console.error("[quiz.js] optionsContainer element is null");
    return;
  }

  els.optionsContainer.innerHTML = "";

  question.options.forEach((optionText, idx) => {
    const letter = String.fromCharCode(65 + idx); // A, B, C, D...

    const label = document.createElement("label");
    label.classList.add("option");

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "answer";
    input.value = letter;

    const span = document.createElement("span");

    // 🔑 Apply definitions using the unified question.terms
    const html = applyDefinitionsToText(optionText, question.terms);
    span.innerHTML = `${letter}. ${html}`;

    label.appendChild(input);
    label.appendChild(span);

    els.optionsContainer.appendChild(label);
  });

  // Highlight behaviour
  const inputs = els.optionsContainer.querySelectorAll("input[name='answer']");
  inputs.forEach((opt) => {
    opt.addEventListener("change", () => {
      inputs.forEach((o) => {
        if (o.parentElement) o.parentElement.style.background = "none";
      });
      if (opt.parentElement) opt.parentElement.style.background = "#4a90e2";
    });
  });
}


function updateNavButtons() {
  if (els.prevBtn) {
    els.prevBtn.disabled = currentIndex === 0;
  }
  if (els.nextBtn) {
    els.nextBtn.disabled = false;
  }
}

// -----------------------------
// Navigation + initialisation
// -----------------------------

function getInitialIndexFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const qParam = params.get("q");
  const num = parseInt(qParam || "1", 10);
  if (!Number.isFinite(num) || num < 1) return 0;
  const idx = num - 1;
  if (idx < 0 || idx >= QUESTIONS.length) return 0;
  return idx;
}

function updateUrlForIndex(index) {
  const qNumber = index + 1;
  const url = new URL(window.location.href);
  url.searchParams.set("q", qNumber.toString());
  window.history.pushState(null, "", url.toString());
}

function setupButtons() {
  if (els.homeBtn) {
    els.homeBtn.addEventListener("click", () => {
      console.log("[quiz.js] Home button clicked");
      window.location.href = "../index.html";
    });
  }

  if (els.prevBtn) {
    els.prevBtn.addEventListener("click", () => {
      console.log("[quiz.js] Prev button clicked on index", currentIndex);
      if (currentIndex > 0) {
        const newIndex = currentIndex - 1;
        renderQuestion(newIndex);
        updateUrlForIndex(newIndex);
      } else {
        window.location.href = "../index.html";
      }
    });
  }

  if (els.nextBtn) {
    els.nextBtn.addEventListener("click", async () => {
      console.log("[quiz.js] Next button clicked on index", currentIndex);
      const question = QUESTIONS[currentIndex];
      const selected = document.querySelector("input[name='answer']:checked");
      if (!selected) {
        alert("Please select an answer before moving on.");
        return;
      }

      const answerValue = selected.value;
      els.nextBtn.disabled = true;

      try {
        await saveResponse({ question, answerValue });

        const newIndex = currentIndex + 1;
        if (newIndex < QUESTIONS.length) {
          renderQuestion(newIndex);
          updateUrlForIndex(newIndex);
        } else {
          window.location.href = "../index.html";
        }
      } catch (err) {
        console.error("[quiz.js] Error saving response:", err);
        alert("There was an error saving your answer. Check the console for details.");
      } finally {
        if (els.nextBtn) els.nextBtn.disabled = false;
      }
    });
  }

  if (els.rewordBtn) {
    els.rewordBtn.addEventListener("click", () => {
      console.log("[quiz.js] Reword button clicked (not implemented yet)");
      alert("Rewording is not implemented yet.");
    });
  }
}

async function initLoggedInUserDisplay() {
  if (!els.loggedInUser) return;

  try {
    const { user } = await ensureAuthAndDbWithUser();
    if (user && user.email) {
      els.loggedInUser.textContent = user.email;
    } else {
      els.loggedInUser.textContent = "(not signed in)";
    }
  } catch (err) {
    console.error("[quiz.js] Error getting user for info bar:", err);
    els.loggedInUser.textContent = "(error)";
  }
}

// -----------------------------
// Boot
// -----------------------------

function init() {
  console.log("[quiz.js] init() starting. document.readyState =", document.readyState);
  console.log("[quiz.js] els at init:", els);

  setupButtons();
  initLoggedInUserDisplay();

  const startIndex = getInitialIndexFromUrl();
  console.log("[quiz.js] startIndex from URL:", startIndex);
  renderQuestion(startIndex);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => {
    console.log("[quiz.js] DOMContentLoaded event fired");
    init();
  });
} else {
  // DOM is already ready
  console.log("[quiz.js] DOM already ready, calling init() immediately");
  init();
}
