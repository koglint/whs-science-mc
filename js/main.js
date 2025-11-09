import { auth, db } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// --- Element lookups (may be null on some pages) ---
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");
const userNameSpan = document.getElementById("user-name");
const statusDiv =
  document.getElementById("login-status") || document.getElementById("status");
const writeBtn = document.getElementById("writeBtn");

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: "education.nsw.gov.au" });

// --- Sign In ---
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      const email = result.user.email;

      if (!email.endsWith("@education.nsw.gov.au")) {
        await signOut(auth);
        if (statusDiv)
          statusDiv.textContent = "Please use your DoE account.";
        return;
      }

      if (statusDiv) statusDiv.textContent = "Signed in as " + email;
    } catch (err) {
      if (statusDiv)
        statusDiv.textContent = "Login error: " + err.message;
      console.error(err);
    }
  });
}

// --- Sign Out ---
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
  });
}

// --- Auth state listener ---
onAuthStateChanged(auth, (user) => {
  const emailOk = user && user.email.endsWith("@education.nsw.gov.au");

  if (loginScreen && appScreen) {
    loginScreen.style.display = emailOk ? "none" : "block";
    appScreen.style.display = emailOk ? "block" : "none";
  }

  if (userNameSpan && emailOk)
    userNameSpan.textContent = user.displayName || user.email;

  // update status on admin page
  if (statusDiv) {
    if (emailOk) statusDiv.textContent = "";
    else statusDiv.textContent = "Please sign in with your DoE account.";
  }
});

// --- Test Firestore Write ---
if (writeBtn) {
  writeBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) return alert("Please sign in first.");

    await setDoc(doc(db, "testCollection", user.uid), {
      name: user.displayName,
      email: user.email,
      timestamp: new Date(),
    });
    alert("Wrote Firestore doc for " + user.email);
  });
}