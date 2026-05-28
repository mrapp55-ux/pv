/**
 * Google OAuth 2.0 client IDs for Google Drive sync.
 *
 * Setup steps:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project (or select existing)
 *   3. Enable the Google Drive API
 *   4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
 *   5. Create one credential for each platform:
 *        - Type "Web application"  → paste its Client ID as GOOGLE_WEB_CLIENT_ID below
 *        - Type "iOS"              → paste its Client ID as GOOGLE_IOS_CLIENT_ID below
 *        - Type "Android"          → paste its SHA-1 fingerprint during creation
 *   6. Add the iOS client ID also to app.json under expo.ios.googleServicesFile or
 *      pass it directly via the GoogleSignin.configure() iosClientId option.
 *
 * The webClientId is required on both iOS and Android for token validation.
 * Leave as empty strings to disable sync (app works fully offline).
 */

export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
