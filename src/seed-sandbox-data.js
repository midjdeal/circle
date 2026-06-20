// seed-sandbox-data.js — CreatorCircle sandbox data seeder
//
// Populates Firestore with realistic test data (circles, members, queue
// submissions) so the app has something to show right after you connect it
// to Firebase, instead of starting completely empty. Run this once after
// deploying firestore.rules, and again any time you want to reset the
// sandbox back to a known state.
//
// This is an ADMIN-ONLY script. It uses the firebase-admin SDK, which
// authenticates with a service account and bypasses firestore.rules
// entirely — never ship this file or its credentials to the client.
//
// ── ONE-TIME SETUP ──────────────────────────────────────────────────────────
// 1. Install the admin SDK (separate from the client `firebase` package):
//      npm install firebase-admin
//
// 2. Generate a service account key:
//      Firebase Console → Project Settings → Service Accounts →
//      "Generate new private key" → save the JSON somewhere outside your
//      repo (e.g. ~/.secrets/creatorcircle-service-account.json).
//
// ── RUNNING IT ───────────────────────────────────────────────────────────
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     node seed-sandbox-data.js
//
// ── MAKING YOURSELF AN ADMIN ─────────────────────────────────────────────
// firestore.rules checks each user's own `users/{uid}.role` field to decide
// admin access — there's no way for this script to know your real Firebase
// Auth uid in advance, since it's only assigned once you actually sign in.
//
// So: sign into the app for real first (Continue with Google works fine —
// it auto-provisions a basic profile on first login), then find your uid in
// Firebase Console → Authentication → Users, then re-run this script with
// that uid set:
//
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     ADMIN_UID=your-real-uid-here node seed-sandbox-data.js
//
// This promotes that uid's existing profile to role:"superadmin" (using a
// merge write, so it won't clobber the name/email/etc. your real sign-in
// already created) without touching anything else. You can run the script
// again later with the same ADMIN_UID — it's safe to re-run.

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const ADMIN_UID = process.env.ADMIN_UID || null;

// ── CIRCLES ──────────────────────────────────────────────────────────────
// Doc id is the circle's "key" field — the app reads it back as
// circle.key, so the id and the key must match.
const CIRCLES = [
  { key:"A", name:"Circle A", req:"< 1k followers",   members:142, active:true,  activity:34, platform:"instagram", group:"Holistic" },
  { key:"B", name:"Circle B", req:"1k–5k followers",  members:287, active:true,  activity:57, platform:"instagram", group:"Fitness Influencer" },
  { key:"C", name:"Circle C", req:"5k–10k followers", members:164, active:true,  activity:78, platform:"instagram", group:"Content Creator" },
  { key:"D", name:"Circle D", req:"> 10k followers",  members:93,  active:false, activity:42, platform:"instagram", group:"Models" },
  { key:"E", name:"Circle E", req:"Verified + 10k+",  members:28,  active:false, activity:91, platform:"instagram", group:"A.I" },
];

// ── MEMBERS ──────────────────────────────────────────────────────────────
// These live in the "users" collection — the same collection a real
// signed-in member's own profile doc lives in (see the long comment in
// firestore.rules for why). Doc ids here are arbitrary sandbox ids, NOT
// real Firebase Auth uids, since these are seed/test people who don't have
// real logins — that's fine, MembersTab in the app already handles
// admin-added members the same way.
const MEMBERS = [
  {
    id: "seed_m1",
    name: "Lucía Ponti", handle: "@luxuria.photo", username: "luxuria.photo",
    email: "lucia.ponti@example.com", plan: "Pro", circle: "C", status: "active",
    role: "member", joined: "2026-02-14", points: 134, supportCount: 15000,
    verified: true, verifiedAtSupportCount: 14900,
    verifiedAt: daysAgoIso(10),
    supportLog: [
      { id:"seed_m1l1", postUrl:"https://www.instagram.com/p/Cz1k2RvI9wQ/", circle:"Circle C", author:"@fithero_kai",   time: hoursAgoIso(2) },
      { id:"seed_m1l2", postUrl:"https://www.instagram.com/p/Cz0a8NpL3sX/", circle:"Circle C", author:"@coachmark_fit", time: hoursAgoIso(26) },
    ],
  },
  {
    id: "seed_m2",
    name: "Kai Fisher", handle: "@fithero_kai", username: "fithero_kai",
    email: "kai.fisher@example.com", plan: "Plus", circle: "B", status: "active",
    role: "member", joined: "2026-03-02", points: 62, supportCount: 340,
    verified: true, verifiedAtSupportCount: 150,
    verifiedAt: daysAgoIso(25),
    supportLog: [],
  },
  {
    id: "seed_m3",
    name: "Maya Restrepo", handle: "@mindful.maya", username: "mindful.maya",
    email: "maya.restrepo@example.com", plan: "Free", circle: "A", status: "active",
    role: "member", joined: "2026-01-22", points: 29, supportCount: 95,
    verified: false, verifiedAtSupportCount: 0, verifiedAt: null,
    supportLog: [],
  },
  {
    id: "seed_m4",
    name: "Sunset Frames Studio", handle: "@sunsetframes", username: "sunsetframes",
    email: "hello@sunsetframes.co", plan: "Pro", circle: "C", status: "pending",
    role: "member", joined: "2026-05-30", points: 0, supportCount: 0,
    verified: false, verifiedAtSupportCount: 0, verifiedAt: null,
    supportLog: [],
  },
  {
    id: "seed_m5",
    name: "Mark Coleman", handle: "@coachmark_fit", username: "coachmark_fit",
    email: "mark.coleman@example.com", plan: "Plus", circle: "B", status: "active",
    role: "member", joined: "2026-04-11", points: 51, supportCount: 6200,
    verified: true, verifiedAtSupportCount: 6000,
    verifiedAt: daysAgoIso(31),
    supportLog: [],
  },
  // A second pending applicant, distinct from m4, so the admin approval flow
  // has more than one item to work through during testing.
  {
    id: "seed_m6",
    name: "Priya Anand", handle: "@priya.creates", username: "priya.creates",
    email: "priya.anand@example.com", plan: "Free", circle: "A", status: "pending",
    role: "member", joined: "2026-06-15", points: 0, supportCount: 0,
    verified: false, verifiedAtSupportCount: 0, verifiedAt: null,
    supportLog: [],
  },
];

// ── REVIEW QUEUE ─────────────────────────────────────────────────────────
// submitterUid intentionally points at one of the seeded member ids above,
// so testing "the original submitter can edit/withdraw their own pending
// post" (per firestore.rules) has something realistic to point at — though
// note that rule only really applies to a real signed-in auth.uid, so it
// won't grant these seed members "real" edit access unless ADMIN_UID-style
// promotion is also done for them via a real account.
const QUEUE = [
  {
    id: "seed_q1",
    handle: "@sunsetframes", type: "Reel", topic: "Bali sunset session — 4K drone",
    circle: "Circle C", submitted: "5m ago", submittedAt: Date.now() - 5*60*1000,
    plan: "Pro", url: "https://www.instagram.com/reel/Cz9k1RgIaXp/",
    submitterUid: "seed_m4",
  },
  {
    id: "seed_q2",
    handle: "@coachmark_fit", type: "Carousel", topic: "Pull-up progression from 0 to 20 reps",
    circle: "Circle B", submitted: "20m ago", submittedAt: Date.now() - 20*60*1000,
    plan: "Plus", url: "https://www.instagram.com/p/Cz7m4ToL9wF/",
    submitterUid: "seed_m5",
  },
  {
    id: "seed_q3",
    handle: "@mindful.maya", type: "Static", topic: "Underrated spots in Porto",
    circle: "Circle A", submitted: "35m ago", submittedAt: Date.now() - 35*60*1000,
    plan: "Free", url: "https://www.instagram.com/p/Cz5h2VqIeRt/",
    submitterUid: "seed_m3",
  },
];

function daysAgoIso(n) { return new Date(Date.now() - n*24*60*60*1000).toISOString(); }
function hoursAgoIso(n) { return new Date(Date.now() - n*60*60*1000).toISOString(); }

async function seedCollection(name, docs, idField = "id") {
  const batch = db.batch();
  docs.forEach(d => {
    const { [idField]: id, ...data } = d;
    batch.set(db.collection(name).doc(id), data, { merge: true });
  });
  await batch.commit();
  console.log(`✓ Seeded ${docs.length} doc(s) into "${name}"`);
}

async function main() {
  await seedCollection("circles", CIRCLES, "key");
  await seedCollection("users", MEMBERS, "id");
  await seedCollection("queue", QUEUE, "id");

  if (ADMIN_UID) {
    await db.collection("users").doc(ADMIN_UID).set({
      role: "superadmin",
      status: "active",
      plan: "Pro",
      // Only fields safe to default if they don't already exist — merge:true
      // means this won't overwrite name/email/handle/etc. that your real
      // Google/email sign-in already set.
      points: admin.firestore.FieldValue.increment(0),
    }, { merge: true });
    console.log(`✓ Promoted users/${ADMIN_UID} to role:"superadmin"`);
  } else {
    console.log("\n⚠ No ADMIN_UID set — skipped admin promotion.");
    console.log("  Sign into the app once (Continue with Google works), find your");
    console.log("  uid in Firebase Console → Authentication → Users, then re-run:");
    console.log("    ADMIN_UID=your-uid-here node seed-sandbox-data.js\n");
  }

  console.log("\nDone. Sandbox data is live — open the app and sign in to see it.");
  process.exit(0);
}

main().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
