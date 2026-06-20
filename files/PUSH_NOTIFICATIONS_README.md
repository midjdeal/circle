# Background push notifications — deployment guide

This adds real, OS-level push notifications to CreatorCircle that arrive even
when the app is closed. It's built from four pieces:

| File | What it does |
|---|---|
| `creator-support-circle.jsx` | Registers the service worker, subscribes the browser to push, listens for tap-to-navigate messages |
| `sw.js` | The service worker — receives pushes in the background and shows them |
| `manifest.json` + `icon-192.png` / `icon-512.png` | Makes the app installable as a PWA (required for reliable background push, especially on mobile) |
| `push-cloud-function.js` | The backend — actually sends the push, using Firebase Cloud Functions + the `web-push` library |

Everything in the JSX file works as-is once deployed; the other three files
need a few setup steps below before push actually delivers end-to-end.

## 1. Generate VAPID keys

VAPID keys are how a push service (browser vendor's push infrastructure)
verifies that pushes for a given subscription are coming from you and not
some random server that found the endpoint.

```
npx web-push generate-vapid-keys
```

This prints a public and private key. Put the **public** key into
`creator-support-circle.jsx`:

```js
const VAPID_PUBLIC_KEY = "paste-the-public-key-here";
```

Keep the **private** key out of the client entirely — it goes into Cloud
Functions config in step 3.

## 2. Host the static files at your domain root

`manifest.json`, `sw.js`, `icon-192.png`, and `icon-512.png` all need to be
served from the root of your domain (e.g. `https://yourapp.com/sw.js`, not
`https://yourapp.com/assets/sw.js`). A service worker can only control pages
within its own scope, so registering it from a subfolder would limit it to
that subfolder.

In a typical Vite project: drop all four files into `/public` — Vite copies
everything in `public/` to the build output root untouched.

You'll also need to add these tags to your real `index.html` (not generated
here, since this project has only ever consisted of the single JSX
component file):

```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#0D0F1A">
```

## 3. Deploy the Cloud Function

```
cd functions
npm install web-push firebase-admin firebase-functions
```

Move `push-cloud-function.js`'s contents into your `functions/index.js` (or
`require`/import it from there), then set the private key and contact
address Cloud Functions needs:

```
firebase functions:config:set \
  vapid.public="your-public-key" \
  vapid.private="your-private-key" \
  vapid.subject="mailto:you@yourapp.com"

firebase deploy --only functions
```

## 4. Wire up subscription storage

`subscribeToPush()` in the JSX has a `TODO` where it should persist the
subscription it gets back from the browser. The Cloud Function file exports
a `savePushSubscription` callable for exactly this — call it from the app
once you have your Firebase SDK wired in:

```js
import { getFunctions, httpsCallable } from "firebase/functions";
const save = httpsCallable(getFunctions(), "savePushSubscription");
await save(sub.toJSON());
```

You'll also need your existing backend logic (wherever it currently fires
`pushNotification(...)` client-side for things like "post approved" or
"payout sent") to also write a doc to
`users/{uid}/notifications/{notificationId}` — that's the trigger
`sendPushOnNotification` listens for for the actual background send.

## What you can verify without deploying

The service worker registration and push subscription flow can be tested
locally over `https` (or `localhost`, which browsers treat as secure) — open
dev tools, go to Notification Preferences, tap Enable, and check
`Application → Service Workers` / `Application → Push Messaging` in Chrome
DevTools to confirm a subscription was created.

What you can't verify without deploying: actual delivery while the app is
closed, since that requires a real backend at a real HTTPS domain to call
`webpush.sendNotification()`. Once steps 1–4 above are done, sending a test
notification from the Firebase console or a manual Firestore write to
`users/{uid}/notifications/` is the fastest way to confirm the full pipeline
works.
