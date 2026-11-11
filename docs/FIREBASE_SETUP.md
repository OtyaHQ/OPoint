# Opoint Firebase setup (manual console checklist)

Firebase project creation and app registration must be completed in the Firebase Console by an authorised Otya administrator. Do not use Omy Play's existing `otya-player` Firebase project.

## 1. Create the project

1. Open https://console.firebase.google.com/
2. Create a new project named **Opoint**.
3. Use a distinct project ID if the preferred ID is available, e.g. `opoint-otya-prod`. Project IDs are globally unique; confirm availability in the console.
4. Keep this project separate from Omy Play and from any development project.
5. Enable Google Analytics only if its data collection purpose and consent/privacy notices are configured for Opoint.

## 2. Register the Android app

1. Register a new Android app in the Opoint Firebase project.
2. Use the Android application ID chosen for Opoint, recommended: `com.otya.opoint`. Confirm it before the first public release because changing the package later requires a new app identity.
3. Download `google-services.json` for the Android build if required by the selected FlutterFire setup. Keep it out of public repositories when using a private configuration workflow.
4. Configure FlutterFire for the correct project and add only the public Firebase client options to the Android build. Firebase client API keys/app IDs are not server secrets, but they must still be restricted and monitored.

## 3. Enable mobile services

Enable:
- Firebase Cloud Messaging;
- Firebase App Check;
- Crashlytics;
- Performance Monitoring;
- Analytics, subject to privacy/consent requirements.

Do not enable Firestore or Firebase Storage for the initial Opoint financial backend. Cloudflare D1 remains the financial source of truth; Cloudflare R2 stores business documents and receipts.

## 4. App Check

1. Register the Android app with App Check.
2. Select Play Integrity for release builds.
3. Add the development/debug provider only for controlled developer builds.
4. Add the production signing certificate SHA-256 fingerprint once the release signing key is established.
5. Start in monitor mode. Review real-device attestation signals before enabling enforcement.
6. App Check supplements authentication and authorisation; it does not replace Otya ID, role checks or transaction controls.

## 5. Server-side FCM credentials

Opoint's Cloudflare Worker needs Firebase Admin SDK credentials to send FCM messages:
1. In the Firebase project, create/use a dedicated service account with only the roles required for FCM.
2. Generate/download a private key only if Workload Identity Federation is not being used.
3. Store the JSON private key in the Opoint-scoped Cloudflare Secrets Store. Never put it in GitHub, the Flutter app, public configuration, logs or chat.
4. Do not reuse Omy Play's service-account credentials.
5. Restrict who can access and rotate this secret.

## 6. Notification design

- Persist notification intent, target identity/device, event type and delivery state in Opoint D1.
- Use an outbox and Queue consumer to send FCM.
- Use authenticated WebSockets for immediate updates while the application is open.
- FCM payloads should contain only a minimal event reference and safe display text.
- The Android app must fetch current transaction status from Opoint after receiving a notification.
- Never put PINs, full customer references, balances or sensitive payment details in push payloads.

## 7. Values to record (not secrets)

After setup, record these values in a private deployment inventory:
- Firebase project ID;
- Firebase project number / sender ID;
- Android app ID;
- Android package name;
- registered SHA-256 certificate fingerprint;
- App Check enforcement mode.

Do not paste a service-account JSON key or private key into ChatGPT. Enter it directly into Cloudflare Secrets Store.

## 8. Validation before enabling production notifications

- Install a signed Opoint build on a real Android device.
- Confirm App Check attestation is received by the backend.
- Register and refresh an FCM token.
- Send a test notification to that device from the Opoint backend.
- Test foreground, background, force-stopped and token-rotation cases.
- Confirm duplicate Queue delivery does not create duplicate business actions.
- Confirm the notification opens the right Opoint screen and the displayed transaction state comes from the API.
