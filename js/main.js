import { auth, db } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");
const userNameSpan = document.getElementById("user-name");
const statusDiv = document.getElementById("login-status");
const writeBtn = document.getElementById("writeBtn");

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: "education.nsw.gov.au" });

// --- Sign In ---
loginBtn.addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const email = result.user.email;
    if (!email.endsWith("@education.nsw.gov.au")) {
      await signOut(auth);
      statusDiv.textContent = "Please use your DoE account.";
      return;
    }
    statusDiv.textContent = "Signed in as " + email;
  } catch (err) {
    statusDiv.textContent = "Login error: " + err.message;
    console.error(err);
  }
});

// --- Sign Out ---
logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

// --- Auth state listener ---
onAuthStateChanged(auth, (user) => {
  if (user && user.email.endsWith("@education.nsw.gov.au")) {
    loginScreen.style.display = "none";
    appScreen.style.display = "block";
    userNameSpan.textContent = user.displayName || user.email;
  } else {
    loginScreen.style.display = "block";
    appScreen.style.display = "none";
  }
});

// --- Test Firestore Write ---
writeBtn.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return alert("Please sign in first.");

  await setDoc(doc(db, "testCollection", user.uid), {
    name: user.displayName,
    email: user.email,
    timestamp: new Date()
  });
  alert("Wrote Firestore doc for " + user.email);
});
