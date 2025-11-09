// Load Firebase from CDN (works on GitHub Pages)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBiOdDV9D9OPnM8BRupPjW2vb2PVc15hOA",
  authDomain: "whssciencemc.firebaseapp.com",
  projectId: "whssciencemc",
  storageBucket: "whssciencemc.firebasestorage.app",
  messagingSenderId: "838246053837",
  appId: "1:838246053837:web:aa91ca0976ba5d80e27684"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
