# Final Word — Mobile Deployment Roadmap

Deployment roadmap for getting Final Word onto the Apple App Store and Google Play Store.

This assumes the React Native/Expo mobile app is already built and functional.

---

## 1. Pre-Deployment Preparation

- [ ] Confirm production API is stable
- [ ] Confirm `api.finalword.io` is reachable over HTTPS
- [ ] Confirm Socket.IO connections work from mobile networks
- [ ] Confirm Supabase production authentication works on iOS and Android
- [ ] Confirm anonymous authentication works
- [ ] Confirm Google authentication works
- [ ] Confirm GitHub authentication works where supported
- [ ] Confirm deep links / OAuth redirects work on mobile
- [ ] Confirm production environment variables
- [ ] Confirm app does not contain development/debug configuration
- [ ] Confirm error logging/monitoring is enabled
- [ ] Confirm production database migrations are complete
- [ ] Confirm rate limiting / Turnstile / abuse protection is enabled
- [ ] Confirm privacy policy is publicly accessible
- [ ] Confirm terms of service are publicly accessible

Recommended public pages:

- `https://finalword.io/privacy`
- `https://finalword.io/terms`

---

# 2. App Identity

Finalize the information that will be shared by both stores.

- [ ] App name: `Final Word`
- [ ] Bundle identifier finalized
- [ ] Android package name finalized
- [ ] Production app version established
- [ ] App icon finalized
- [ ] Splash screen finalized
- [ ] Store description written
- [ ] Short description written
- [ ] Keywords/category determined
- [ ] Support URL created
- [ ] Privacy policy URL created
- [ ] Terms URL created
- [ ] Contact/support email established

Keep the iOS bundle ID and Android package name permanent once released.

Example:

```text
iOS:
io.finalword.app

Android:
io.finalword.app
```

---

# 3. Apple Developer Account

## Account

- [ ] Enroll in Apple Developer Program
- [ ] Complete identity/business verification
- [ ] Confirm Apple Developer account is active

## App Store Connect

- [ ] Create Final Word app in App Store Connect
- [ ] Select correct bundle ID
- [ ] Configure app information
- [ ] Configure App Store category
- [ ] Configure age rating
- [ ] Configure pricing/availability
- [ ] Complete App Privacy questionnaire
- [ ] Add privacy policy URL
- [ ] Add support URL
- [ ] Add marketing URL if desired

## App Store Assets

- [ ] App icon
- [ ] iPhone screenshots
- [ ] iPad screenshots if supporting iPad
- [ ] App description
- [ ] Keywords
- [ ] Promotional text if desired
- [ ] App subtitle
- [ ] Support information

---

# 4. Google Play Developer Account

## Account

- [ ] Create Google Play Console account
- [ ] Pay registration fee
- [ ] Complete identity verification
- [ ] Complete developer account setup

## App

- [ ] Create Final Word application
- [ ] Configure application ID/package name
- [ ] Configure app category
- [ ] Configure content rating
- [ ] Configure target audience
- [ ] Complete Data Safety questionnaire
- [ ] Add privacy policy URL
- [ ] Add support/contact information

## Store Assets

- [ ] App icon
- [ ] Phone screenshots
- [ ] Tablet screenshots if supported
- [ ] Short description
- [ ] Full description
- [ ] Feature graphic
- [ ] Category/tags

---

# 5. Production Signing & Build Configuration

## iOS

- [ ] Configure Apple signing
- [ ] Configure bundle identifier
- [ ] Configure provisioning/signing through Expo/EAS
- [ ] Configure production build profile
- [ ] Confirm production environment variables
- [ ] Build production `.ipa`

## Android

- [ ] Configure Android package name
- [ ] Configure Android signing
- [ ] Create/manage production keystore
- [ ] Configure production build profile
- [ ] Confirm production environment variables
- [ ] Build production `.aab`

### Important

Back up production signing credentials securely.

Losing Android signing credentials can create serious problems for future updates.

---

# 6. Mobile Production Configuration

Before submitting either app:

- [ ] Production API URL
- [ ] Production Socket.IO URL
- [ ] Production Supabase URL
- [ ] Production Supabase configuration
- [ ] OAuth redirect URLs
- [ ] Deep linking configuration
- [ ] App scheme
- [ ] Push notification configuration if used
- [ ] Analytics configuration if used
- [ ] Crash/error reporting configuration
- [ ] Production app version
- [ ] Production build number/version code

Test the app against the **real production server**, not localhost.

---

# 7. iOS TestFlight

Create the first production candidate build.

- [ ] Create production iOS build
- [ ] Upload to App Store Connect
- [ ] Wait for Apple processing
- [ ] Add internal testers
- [ ] Install through TestFlight
- [ ] Test authentication
- [ ] Test anonymous accounts
- [ ] Test matchmaking
- [ ] Test Battle Royale
- [ ] Test Duels
- [ ] Test reconnecting
- [ ] Test poor network conditions
- [ ] Test app backgrounding/resuming
- [ ] Test closing/reopening the app
- [ ] Test purchases if implemented
- [ ] Test account deletion if applicable
- [ ] Test privacy/terms links
- [ ] Fix critical issues
- [ ] Upload final candidate build

### External TestFlight

- [ ] Add external testers if desired
- [ ] Submit beta for Apple's TestFlight review if required
- [ ] Run larger beta
- [ ] Collect feedback
- [ ] Fix launch-blocking issues

---

# 8. Google Play Testing

## Internal Testing

- [ ] Upload Android `.aab`
- [ ] Create internal testing track
- [ ] Add testers
- [ ] Install through Google Play
- [ ] Test production functionality
- [ ] Fix issues

## Closed Testing

If the developer account is subject to Google's new-account testing requirements:

- [ ] Create closed testing release
- [ ] Recruit required testers
- [ ] Maintain required testing period
- [ ] Collect tester feedback
- [ ] Complete Google Play production-access requirements

- [ ] Request production access when eligible

---

# 9. Final Production QA

Before submitting to either store, perform a final production test.

### Authentication

- [ ] New anonymous user
- [ ] Existing anonymous user
- [ ] Sign in
- [ ] Sign out
- [ ] OAuth login
- [ ] Session persistence
- [ ] App restart

### Gameplay

- [ ] Start game
- [ ] Submit guesses
- [ ] Invalid guesses
- [ ] Correct guesses
- [ ] Game completion
- [ ] Game timeout
- [ ] Reconnection
- [ ] Multiple players
- [ ] Duels
- [ ] Battle Royale
- [ ] Leaderboards
- [ ] Stats/metrics

### Network

- [ ] Wi-Fi
- [ ] Cellular
- [ ] Temporary connection loss
- [ ] Server reconnect
- [ ] App background/resume
- [ ] Server restart

### Account / Data

- [ ] Account creation
- [ ] Account persistence
- [ ] Account deletion if supported
- [ ] Privacy policy
- [ ] Terms of service

### Payments

If mobile subscriptions are supported:

- [ ] Purchase
- [ ] Restore purchase
- [ ] Cancel subscription
- [ ] Expired subscription
- [ ] Backend entitlement update
- [ ] Cross-platform entitlement behavior

---

# 10. App Store Submission — Apple

- [ ] Select final build
- [ ] Complete App Store listing
- [ ] Complete App Privacy
- [ ] Complete age rating
- [ ] Complete export compliance questions
- [ ] Add review notes
- [ ] Provide demo/test account if required
- [ ] Verify screenshots
- [ ] Verify description
- [ ] Verify privacy policy
- [ ] Verify support URL
- [ ] Submit for App Review

### Apple Review Notes

Give reviewers enough information to actually test the game.

Include:

- How to start a game
- How authentication works
- How to access major features
- Test account credentials if needed
- Any features requiring multiple players
- Any features that require special setup

---

# 11. App Store Submission — Google Play

- [ ] Select production-ready `.aab`
- [ ] Complete store listing
- [ ] Complete Data Safety
- [ ] Complete content rating
- [ ] Complete target audience
- [ ] Complete app access information
- [ ] Provide test account if required
- [ ] Verify screenshots
- [ ] Verify privacy policy
- [ ] Verify support information
- [ ] Submit production release

---

# 12. Launch

## Apple

- [ ] App approved
- [ ] Release manually or automatically
- [ ] Confirm app is publicly searchable
- [ ] Install from App Store
- [ ] Test production installation
- [ ] Verify OAuth/deep links
- [ ] Verify backend connectivity

## Google

- [ ] Production release approved
- [ ] Roll out release
- [ ] Confirm app is publicly available
- [ ] Install from Google Play
- [ ] Test production installation
- [ ] Verify OAuth/deep links
- [ ] Verify backend connectivity

---

# 13. Post-Launch Monitoring

For the first several days, monitor closely.

- [ ] Server CPU/memory
- [ ] Server errors
- [ ] Socket.IO connection failures
- [ ] Supabase errors
- [ ] Authentication failures
- [ ] Game completion failures
- [ ] Database errors
- [ ] API latency
- [ ] Crash reports
- [ ] App Store reviews
- [ ] Google Play reviews
- [ ] Player feedback

Pay particular attention to mobile-specific failures that won't appear in web testing.

---

# 14. Release Pipeline Going Forward

Once both apps are live, future releases should follow:

```text
Code changes
     ↓
Local testing
     ↓
Production backend deployed
     ↓
Mobile production build
     ↓
TestFlight / Google Play testing
     ↓
QA
     ↓
Apple submission
     ↓
Google submission
     ↓
Approved
     ↓
Release
     ↓
Monitor
```

Keep the mobile version and backend compatible.

Avoid deploying a backend change that requires a new mobile client before the new mobile version is available to users.

---

# 15. Monetization — Mobile

If Final Word eventually uses subscriptions:

### Web

```text
Final Word Web
      ↓
    Polar
      ↓
Backend entitlement
```

### iOS

```text
Final Word iOS
      ↓
Apple In-App Purchase
      ↓
Backend entitlement
```

### Android

```text
Final Word Android
      ↓
Google Play Billing
      ↓
Backend entitlement
```

The backend should ultimately treat all three as the same subscription entitlement.

Do not make the mobile subscription implementation a launch blocker unless monetization is required for the initial release.

---

# 16. Final Launch Checklist

Before announcing Final Word publicly:

- [ ] Website live
- [ ] API live
- [ ] Web game working
- [ ] iOS app approved
- [ ] Android app approved
- [ ] Privacy policy live
- [ ] Terms live
- [ ] Support/contact information live
- [ ] Crash monitoring active
- [ ] Server monitoring active
- [ ] Authentication verified
- [ ] Realtime verified
- [ ] Gameplay verified
- [ ] Store listings verified
- [ ] App Store installation verified
- [ ] Google Play installation verified
- [ ] Production purchases verified if applicable
- [ ] Launch announcement prepared

---

# Launch Goal

Final Word should ultimately be available from:

- `finalword.io`
- Apple App Store
- Google Play Store

All three clients should connect to the same production backend and share the same player accounts, game data, progression, and entitlements.