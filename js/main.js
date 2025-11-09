import { auth, db } from "./firebase-init.js";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, setDoc, getDoc } from "firebase/firestore";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ hd: "education.nsw.gov.au" });

const loginBtn = document.getElementById("loginBtn");
const writeBtn = document.getElementById("writeBtn");

loginBtn.addEventListener("click", async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    console.log("Signed in:", result.user.email);
  } catch (err) {
    console.error("Login error:", err.message);
  }
});

writeBtn.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return console.warn("Please sign in first");

  await setDoc(doc(db, "testCollection", user.uid), {
    name: user.displayName,
    email: user.email,
    timestamp: new Date()
  });
  console.log("Wrote Firestore doc for", user.email);
});
