# Android signing fingerprints for Opoint

Opoint Firebase identity:
- Project: `opoint-otya-prod`
- Package: `com.otya.opoint`
- Android Firebase App ID: `1:364659191146:android:159ab2c76deafd5628c913`

The Firebase client configuration does not contain the SHA-1 or SHA-256 certificate fingerprints.

## Obtain fingerprints

For a local development variant on a computer with the Android Gradle project installed:

```bash
cd android
./gradlew signingReport
```

This reports the fingerprints for each build variant. A debug certificate is for development only.

For the production app, use the app-signing certificate shown in Google Play Console under the Opoint app's App integrity / App signing key certificate section. If Play Console shows multiple certificates for the app's current signing configuration, register the required current fingerprints for all supported distribution channels. Keep the upload certificate separate from the Google Play app-signing certificate.

For Firebase App Check with Play Integrity, register the production app-signing SHA-256 both in Firebase Project Settings → General → Your apps and in Firebase App Check → Apps → the Opoint Android app → Play Integrity. Link the Play Integrity API to the same Google Cloud project used by `opoint-otya-prod`.

For Google OAuth or other providers that ask for SHA-1, use the app-signing SHA-1 from Play Console. Do not substitute the Firebase project number or Android App ID.

## Current status

The development environment used to prepare this branch does not contain an Opoint release keystore, Android Gradle/Flutter toolchain or Google Play app-signing certificate. Generating a random key here would produce a fingerprint that does not match the user's release binary. We will not invent a production SHA or create an unrelated throwaway key.

The production fingerprints can be registered when the Play app is created and Play App Signing certificates are available. Keep private keystores and passwords out of GitHub, chat and build logs.
