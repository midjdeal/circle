// functions/index.js — CreatorCircle backend push delivery
//
// This is the missing piece that makes push notifications real: everything in
// src/App.jsx and public/sw.js handles the browser side (subscribing,
// receiving, displaying), but a push only ever gets delivered if something
// server-side actually calls the Push API on the subscriber's behalf. That's
// what this file does, using Cloud Functions (2nd gen) + the `web-push` npm
// library + VAPID keys.
//
// ── WHY 2ND GEN + PARAMS (and not functions.config()) ────────────────────────
// The old `functions.config()` runtime-config API was removed in
// firebase-functions v7, so configuration now goes through the params module
// (firebase-functions/params): non-secret values via defineString, and the
// VAPID private key via defineSecret (stored in Cloud Secret Manager, never in
// source or plain env). See ONE-TIME SETUP below.
//
// ── ONE-TIME SETUP ──────────────────────────────────────────────────────────
// 1. Generate a VAPID key pair:
//      npx web-push generate-vapid-keys
//    Put the PUBLIC key in the web app's env as VITE_VAPID_PUBLIC_KEY
//    (see .env.example) — it's shipped to clients, so it's not a secret.
//
// 2. Provide config to the functions. The public key and subject are plain
//    params; the private key is a Secret Manager secret:
//      firebase functions:secrets:set VAPID_PRIVATE      # paste the private key
//    Non-secret params can be set in functions/.env (committed-safe values
//    only) or answered interactively at deploy time:
//      VAPID_PUBLIC=<public-key>
//      VAPID_SUBJECT=mailto:support@midjdeal.com
//
// 3. Install deps and deploy:
//      cd functions && npm install
//      firebase deploy --only functions
//
// ── REGION ───────────────────────────────────────────────────────────────────
// The Firestore database is in the eur3 multi-region (see firebase.json), and
// 2nd-gen Firestore triggers must run in a region compatible with the database
// location — us-central1 (the default) would fail to deploy against eur3. Both
// functions are pinned to europe-west1 (an eur3 read-write region). The client
// therefore calls the callable via getFunctions(app, "europe-west1") — see
// src/firebase.js.
//
// ── DATA MODEL THIS ASSUMES ─────────────────────────────────────────────────
// users/{uid}/pushSubscriptions/{subscriptionId}  — one doc per browser/device
//   subscribed, written by savePushSubscription (below), which subscribeToPush()
//   in App.jsx calls. Each doc is the raw PushSubscription.toJSON() shape:
//   { endpoint, keys: { p256dh, auth } }.
//
// users/{uid}/notifications/{notificationId}  — one doc per notification to
//   send, written by the app's notifyUser() helper (e.g. when a post is
//   approved, a payout is processed, a referral subscribes, etc). Shape:
//   { type, title, body, targetScreen, createdAt }
//
// sendPushOnNotification triggers on notification doc creation and fans it out
// to every subscription stored for that user.

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const webpush = require("web-push");

initializeApp();
const db = getFirestore();

const REGION = "europe-west1"; // eur3-compatible; see REGION note above.

// VAPID config. Public key + subject are not secret (the public key ships to
// every client anyway); the private key is a Secret Manager secret.
const VAPID_PUBLIC = defineString("VAPID_PUBLIC");
const VAPID_PRIVATE = defineSecret("VAPID_PRIVATE");
const VAPID_SUBJECT = defineString("VAPID_SUBJECT", {
  default: "mailto:support@midjdeal.com",
});

// Fires whenever a new notification doc is created for a user. This is the
// real-world trigger point: wherever the app writes a row that represents
// "something happened that this user should hear about" (post approved, payout
// sent, referral subscribed, support reply, etc), that write turns into an
// actual background push instead of just an in-app one.
exports.sendPushOnNotification = onDocumentCreated(
  {
    document: "users/{uid}/notifications/{notificationId}",
    region: REGION,
    secrets: [VAPID_PRIVATE],
  },
  async (event) => {
    // Params are only readable at runtime (secrets especially), so configure
    // web-push inside the handler rather than at module load.
    webpush.setVapidDetails(
      VAPID_SUBJECT.value(),
      VAPID_PUBLIC.value(),
      VAPID_PRIVATE.value()
    );

    const snap = event.data;
    if (!snap) return; // deleted before the function ran
    const { uid } = event.params;
    const notification = snap.data();

    const subsSnap = await db
      .collection("users")
      .doc(uid)
      .collection("pushSubscriptions")
      .get();

    if (subsSnap.empty) {
      console.log(`No push subscriptions for user ${uid}; skipping.`);
      return;
    }

    const payload = JSON.stringify({
      type: notification.type || null,
      title: notification.title || "CreatorCircle",
      body: notification.body || "",
      targetScreen: notification.targetScreen || null,
    });

    const results = await Promise.allSettled(
      subsSnap.docs.map((doc) => {
        const subscription = doc.data();
        return webpush.sendNotification(subscription, payload).catch((err) => {
          // 404/410 means the subscription is gone (user revoked permission,
          // uninstalled, browser data cleared) — clean it up so future sends
          // don't keep failing against a dead endpoint.
          if (err.statusCode === 404 || err.statusCode === 410) {
            return doc.ref.delete();
          }
          throw err;
        });
      })
    );

    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      console.error(
        `${failed.length}/${results.length} pushes failed for user ${uid}:`,
        failed.map((f) => f.reason && f.reason.message)
      );
    }
  }
);

// HTTPS callable the app uses to save a subscription server-side. Routing it
// through a callable keeps subscription writes validated/auth-checked
// server-side rather than trusting the client to write to the right path —
// which is also why firestore.rules denies all client writes to
// users/{uid}/pushSubscriptions (the Admin SDK here bypasses those rules).
exports.savePushSubscription = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  const uid = request.auth.uid;
  const { endpoint, keys } = request.data || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new HttpsError("invalid-argument", "Malformed push subscription.");
  }

  // Use a stable, short doc id derived from the endpoint so re-subscribing
  // the same browser overwrites rather than duplicates.
  const subId = Buffer.from(endpoint)
    .toString("base64")
    .slice(-40)
    .replace(/[/+=]/g, "_");

  await db
    .collection("users")
    .doc(uid)
    .collection("pushSubscriptions")
    .doc(subId)
    .set({ endpoint, keys, updatedAt: FieldValue.serverTimestamp() });

  return { success: true };
});
