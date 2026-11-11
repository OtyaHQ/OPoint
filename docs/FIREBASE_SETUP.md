## 0. Provisioning status — 11 November 2026

The dedicated Opoint Firebase project and Android app have been created. The uploaded `google-services.json` was inspected and its identity values match the intended Opoint application:

| Field | Confirmed value |
|---|---|
| Firebase project ID | `opoint-otya-prod` |
| Firebase project number / sender ID | `364659191146` |
| Firebase Android App ID | `1:364659191146:android:159ab2c76deafd5628c913` |
| Android application ID | `com.otya.opoint` |
| OAuth client entries in this config | None |

The configuration file contains a Firebase client API key. Firebase documents these Firebase-provisioned client keys as public project/app identifiers, not server credentials. Keep the key limited to Firebase services, preserve its Firebase API restrictions, and never reuse it for unrelated Google Cloud APIs. The Admin service-account private key is separate and must never be placed in the Android app or a public repository.

The full `google-services.json` is intentionally not committed to this public repository. Use a controlled private build configuration or CI secret/file for Android builds.

# Opoint Firebase setup (manual console checklist)

Firebase project creation and app registration must be completed in the Firebase Console by an authorised Otya administrator. **Opoint and Omy Play must use separate Firebase projects and separate Android application IDs.** Do not register Opoint inside Omy Play's existing `otya-player` project.

## 1. Product identity and package names

| Product | Android application ID | Firebase project |
|---|---|---|
| Opoint | `com.otya.opoint` | New dedicated Opoint project |
| Omy Play | `com.otyaplayer.app` | Existing Omy Play project `otya-player` |

Omy Play's current Android Gradle configuration declares both `namespace` and `applicationId` as `com.otyaplayer.app`. Preserve that identifier for compatibility with existing installs and future app updates.

Opoint is a new Android app and should use `com.otya.opoint`, provided the identifier is not already registered in Google Play or another relevant distribution channel. Confirm it before registering. Once an app is published, changing the application ID makes it a different app rather than an update.

## 2. Create the Opoint project

1. Open https://console.firebase.google.com/
2. Create a new project named **Opoint**.
3. Use `opoint-otya-prod` as the preferred project ID if available. Project IDs are globally unique and cannot be changed after creation.
4. Keep this project separate from Omy Play's `otya-player` Firebase project.
5. Enable Google Analytics only if its data collection purpose and consent/privacy notices are configured for Opoint.

## 3. Register the Opoint Android app

1. In the new Opoint Firebase project, add an Android app.
2. Enter this exact application ID: `com.otya.opoint`.
3. Enter an internal nickname such as `Opoint Android`.
4. Download `google-services.json` for the Opoint app. It is a client configuration file with identifiers, not a server service-account private key.
5. Keep the file out of public repositories and apply the team's private build-configuration process.

Do not register `com.otyaplayer.app` in this Opoint project. That app belongs to Omy Play.

## 4. Enable mobile services

Enable:
- Firebase Cloud Messaging;
- Firebase App Check;
- Crashlytics;
- Performance Monitoring;
- Analytics, subject to privacy/consent requirements.

Do not enable Firestore or Firebase Storage for the initial Opoint financial backend. Cloudflare D1 remains the financial source of truth; Cloudflare R2 stores business documents and receipts.

## 5. App Check

1. Register the Opoint Android app with App Check.
2. Select Play Integrity for release builds.
3. Add the development/debug provider only for controlled developer builds.
4. Add the production signing certificate SHA-256 fingerprint once the release signing key is established.
5. Start in monitor mode. Review real-device attestation signals before enabling enforcement.
6. App Check supplements authentication and authorisation; it does not replace Otya ID, role checks or transaction controls.

## 6. Server-side FCM credentials

Opoint's Cloudflare Worker needs Firebase Admin credentials to send FCM messages:

1. Create or select a dedicated service account in the Opoint Google Cloud project with only the roles required for FCM.
2. Prefer a workload-identity-based approach where supported. If a service-account key is needed, generate it only for the Opoint project.
3. Store the credential in the Opoint-scoped Cloudflare Secrets Store. Never put it in GitHub, the Flutter app, public configuration, logs or chat.
4. Do not reuse Omy Play's service-account credentials.
5. Restrict access and rotate credentials under a documented process.

## 7. Notification design

- Persist notification intent, target identity/device, event type and delivery state in Opoint D1.
- Use an outbox and Queue consumer to send FCM.
- Use authenticated WebSockets for immediate updates while the application is open.
- FCM payloads should contain only a minimal event reference and safe display text.
- The Android app must fetch current transaction status from Opoint after receiving a notification.
- Never put PINs, full customer references, balances or sensitive payment details in push payloads.

## 8. Values to record (not secrets)

After setup, record these values in a private deployment inventory:
- Firebase project ID;
- Firebase project number / sender ID;
- Firebase Android App ID;
- Android package name (`com.otya.opoint`);
- registered SHA-256 certificate fingerprint;
- App Check enforcement mode.

Do not paste a service-account JSON key or private key into ChatGPT. Enter it directly into Cloudflare Secrets Store.

## 9. Validation before enabling production notifications

- Install a signed Opoint build on a real Android device.
- Confirm App Check attestation is received by the backend.
- Register and refresh an FCM token.
- Send a test notification to that device from the Opoint backend.
- Test foreground, background, force-stopped and token-rotation cases.
- Confirm duplicate Queue delivery does not create duplicate business actions.
- Confirm the notification opens the right Opoint screen and the displayed transaction state comes from the API.
