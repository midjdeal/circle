# Background push notifications — deployment guide

This adds real, OS-level push notifications to CreatorCircle that arrive even
when the app is closed. It's built from four pieces:

| File | What it does |
|---|---|
| `src/App.jsx` | Registers the service worker, subscribes the browser to push, listens for tap-to-navigate messages |
| `public/sw.js` | The service worker — receives pushes in the background and shows them |
| `public/manifest.json` + `public/icon-192.png` / `public/icon-512.png` | Makes the app installable as a PWA (required for reliable background push, especially on mobile) |
| `functions/index.js` | The backend — actually sends the push, using Cloud Functions (2nd gen) + the `web-push` library |

The browser side is fully wired: `subscribeToPush()` in `App.jsx` subscribes
and persists the subscription via the `savePushSubscription` callable in
`functions/index.js`. What's left is generating VAPID keys and providing them
as config, then deploying the functions.

## 1. Generate VAPID keys

VAPID keys are how a push service (browser vendor's push infrastructure)
verifies that pushes for a given subscription are coming from you and not
some random server that found the endpoint.

```
npx web-push generate-vapid-keys
```

This prints a public and private key.

- The **public** key ships to clients — put it in the web app's env as
  `VITE_VAPID_PUBLIC_KEY` (see `.env.example`; copy to `.env.local`).
- The **private** key stays server-side only — it goes into Cloud Secret
  Manager in step 3, never into source or the client bundle.

## 2. Static files are already in place

`manifest.json`, `sw.js`, and the icons already live in `public/`, and Vite
copies everything there to the build output root untouched — so they're served
from the domain root (e.g. `https://yourapp.com/sw.js`), which a service worker
requires to control the whole app. `index.html` already links the manifest and
sets the theme color. Nothing to do here.

## 3. Configure and deploy the Cloud Functions

The functions are 2nd gen and read config through the params module
(`firebase-functions/params`) — the old `functions.config()` API was removed in
firebase-functions v7. Config splits into non-secret params and one secret:

```
cd functions
npm install

# Non-secret params — copy the example and fill in the public key:
cp .env.example .env
#   VAPID_PUBLIC=<the public key from step 1>
#   VAPID_SUBJECT=mailto:support@midjdeal.com

# The private key is a Secret Manager secret (prompts for the value):
firebase functions:secrets:set VAPID_PRIVATE

firebase deploy --only functions
```

**Region:** both functions are pinned to `europe-west1` because the Firestore
database is in the `eur3` multi-region (see `firebase.json`) and 2nd-gen
Firestore triggers must run in a database-compatible region — the default
`us-central1` would fail to deploy. The client calls the callable via
`getFunctions(app, "europe-west1")` (see `src/firebase.js`) to match.

## 4. How subscriptions and sends are already wired

- **Saving a subscription:** `subscribeToPush()` in `App.jsx` calls the
  `savePushSubscription` callable, which writes to
  `users/{uid}/pushSubscriptions/{subId}`. Client writes to that path are
  denied by `firestore.rules` on purpose — only the callable (Admin SDK,
  which bypasses rules) writes there.
- **Sending a push:** the app's `notifyUser()` helper writes a doc to
  `users/{uid}/notifications/{notificationId}` for the in-app notification.
  The `sendPushOnNotification` trigger fires on that same write and fans the
  notification out to every stored subscription for that user — so any event
  that already produces an in-app notification also becomes a background push,
  with no extra call site.

## What you can verify without deploying

The service worker registration and push subscription flow can be tested
locally over `https` (or `localhost`, which browsers treat as secure), as long
as `VITE_VAPID_PUBLIC_KEY` is set in `.env.local` — open dev tools, go to
Notification Preferences, tap Enable, and check
`Application → Service Workers` / `Application → Push Messaging` in Chrome
DevTools to confirm a subscription was created. With the key unset,
`subscribeToPush()` intentionally no-ops (push disabled) instead of throwing.

What you can't verify without deploying: actual delivery while the app is
closed, since that requires the deployed functions to call
`webpush.sendNotification()`. Once steps 1–3 are done, a manual Firestore write
to `users/{uid}/notifications/` (or any in-app action that calls
`notifyUser()`) is the fastest way to confirm the full pipeline works.
