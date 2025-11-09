// firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const BACKEND_BASE_URL = "https://whs-science-mc.onrender.com";

let firebaseConfig;

try {
  const res = await fetch(`${BACKEND_BASE_URL}/api/config`);
  firebaseConfig = await res.json();
} catch (err) {
  console.error("Failed to load Firebase config:", err);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
