// firebase.js — CreatorCircle client-side Firebase setup
//
// Put this in src/firebase.js. It initializes the same Firebase project your
// config already points at (midjdeal-53a07) and exports the pieces the app
// needs: auth, Firestore, and the callable Functions wrapper used by
// subscribeToPush() in App.jsx to persist push subscriptions server-side.
//
// Install the SDK first if you haven't:
//   npm install firebase

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAPR4VWci6hRaN71QnNn3i5DAX_laQ5Htk",
  authDomain: "midjdeal-53a07.firebaseapp.com",
  projectId: "midjdeal-53a07",
  storageBucket: "midjdeal-53a07.firebasestorage.app",
  messagingSenderId: "247367124456",
  appId: "1:247367124456:web:92beedb6b126bbfd50905d",
  measurementId: "G-DY3GQ7W4N8",
};

export const app = initializeApp(firebaseConfig);

// Analytics only works in a real browser with a measurement ID and will
// throw in non-browser contexts (SSR, tests) — guard it.
export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;

export const auth = getAuth(app);
// One shared GoogleAuthProvider instance — signInWithPopup(auth, googleProvider)
// is called from LoginScreen.
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app);

// Matches the savePushSubscription callable exported from
// push-cloud-function.js. Calling this is what subscribeToPush() in App.jsx
// should do instead of just console.logging the subscription.
export const savePushSubscription = httpsCallable(functions, "savePushSubscription");
