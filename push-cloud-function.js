// push-cloud-function.js — CreatorCircle backend push delivery
//
// This is the missing piece that makes push notifications real: everything in
// creator-support-circle.jsx and sw.js handles the browser side (subscribing,
// receiving, displaying), but a push only ever gets delivered if something
// server-side actually calls the Push API on the subscriber's behalf. That's
// what this file does, using Firebase Cloud Functions + the `web-push` npm
// library + VAPID keys.
//
// ── ONE-TIME SETUP ──────────────────────────────────────────────────────────
// 1. Generate a VAPID key pair:
//      npx web-push generate-vapid-keys
//    Put the PUBLIC key in creator-support-circle.jsx as VAPID_PUBLIC_KEY.
//    Put the PRIVATE key in Cloud Functions config (never in client code):
//      firebase functions:config:set vapid.public="<public>" vapid.private="<private>" vapid.subject="mailto:you@yourapp.com"
//
// 2. In your functions project:
//      cd functions && npm install web-push firebase-admin firebase-functions
//
// 3. Deploy:
//      firebase deploy --only functions
//
// ── DATA MODEL THIS ASSUMES ─────────────────────────────────────────────────
// users/{uid}/pushSubscriptions/{subscriptionId}  — one doc per browser/device
//   subscribed, written by the app's subscribeToPush() (see the TODO comment
//   there). Each doc is the raw PushSubscription.toJSON() shape: { endpoint,
//   keys: { p256dh, auth } }.
//
// users/{uid}/notifications/{notificationId}  — one doc per notification to
//   send, written by your existing app logic (e.g. when a post is approved,
//   a payout completes, etc — the same events that already call
//   pushNotification() client-side for the foreground case). Shape:
//   { type, title, body, targetScreen, createdAt }
//
// The function below triggers on notification doc creation and fans it out
// to every subscription stored for that user.

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const webpush = require("web-push");

admin.initializeApp();
const db = admin.firestore();

webpush.setVapidDetails(
  functions.config().vapid.subject,   // e.g. "mailto:you@yourapp.com"
  functions.config().vapid.public,
  functions.config().vapid.private
);

// Fires whenever a new notification doc is created for a user. This is the
// real-world trigger point: wherever your existing backend logic currently
// writes a row that represents "something happened that this user should
// hear about" (post approved, payout sent, referral subscribed, support
// reply, etc), writing it here is what turns it into an actual background
// push instead of just an in-app one.
exports.sendPushOnNotification = functions.firestore
  .document("users/{uid}/notifications/{notificationId}")
  .onCreate(async (snap, context) => {
    const { uid } = context.params;
    const notification = snap.data();

    const subsSnap = await db.collection("users").doc(uid)
      .collection("pushSubscriptions").get();

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
      console.error(`${failed.length}/${results.length} pushes failed for user ${uid}:`,
        failed.map((f) => f.reason && f.reason.message));
    }
  });

// HTTPS callable the app can use to save a subscription server-side. This is
// what subscribeToPush()'s TODO comment in creator-support-circle.jsx should
// call instead of (or in addition to) a direct Firestore write — routing it
// through a callable keeps subscription writes validated/auth-checked
// server-side rather than trusting the client to write to the right path.
exports.savePushSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }
  const uid = context.auth.uid;
  const { endpoint, keys } = data || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new functions.https.HttpsError("invalid-argument", "Malformed push subscription.");
  }

  // Use a stable, short doc id derived from the endpoint so re-subscribing
  // the same browser overwrites rather than duplicates.
  const subId = Buffer.from(endpoint).toString("base64").slice(-40).replace(/[/+=]/g, "_");

  await db.collection("users").doc(uid)
    .collection("pushSubscriptions").doc(subId)
    .set({ endpoint, keys, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  return { success: true };
});
