# Elevance Skills

Next.js training application for multilingual settings, subscription plans, and story/post creation.

## Run Locally

Use Node.js 24 or newer and install dependencies:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

The app uses the local SQLite database at `data/storyline.db`. The schema is initialized additively on first server request. Local database and journal files are ignored by Git.

## Service Configuration

Set real values in `.env.local` or the deployment provider's secret store. Never commit these values.

- `SESSION_SECRET`: at least 32 random characters. The trusted identity integration must mint the signed `elevance_session` token using `createSessionToken` in `lib/auth.ts`, with a database user ID and expiry. This repository does not yet include sign-in or token issuance.
- `OTP_HASH_SECRET`: independent random secret of at least 32 characters.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL`: email OTP for French and payment receipts.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: SMS OTP for English, Spanish, Hindi, Portuguese, and Chinese.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`: paid plan checkout and payment verification.
- `RAZORPAY_WEBHOOK_SECRET`: signature verification for `POST /api/payments/webhook`.

Authenticated accounts must have a registered `email` and `phone` in `users`. The application never returns an OTP to the browser. OTPs are cryptographically generated, HMAC-hashed at rest, expire after five minutes, allow five failed attempts, lock for 15 minutes, and are limited to five sends per hour with a 60-second resend cooldown.

## Subscription Rules

- Free: INR 0, one post per UTC calendar month.
- Bronze: INR 100, three posts per month.
- Silver: INR 300, five posts per month.
- Gold: INR 1,000, unlimited posts.
- Paid access lasts 30 days. The user can renew by purchasing again after expiry; automatic recurring billing is not enabled.
- Razorpay orders can be created only from 05:00 through 10:59 IST. This is checked by the server.
- Post creation checks the signed user, active unexpired subscription, and monthly post count inside a SQLite write transaction before inserting the story.
- Cancellation stops the next renewal; current access remains until expiry.
- Resend sends a plain-text payment receipt after a verified payment when email is configured. Tax invoice fields are not collected by this project.

## API Surface

- `POST /api/posts`: authenticated story/post creation and subscription quota enforcement.
- `GET|POST|DELETE /api/subscription`: read status, activate the one-time free plan, and cancel current access at expiry.
- `POST /api/payments/order`: server-side time gate and Razorpay order creation.
- `POST /api/payments/verify`: ownership, amount, currency, and gateway signature verification before activation.
- `POST /api/payments/webhook`: Razorpay webhook signature verification and idempotent payment activation.
- `GET|POST /api/language/otp`: read saved language and request a language-change OTP.
- `POST /api/language/verify`: enforce attempts/expiry and persist the selected language only after verification.

## Important Deployment Note

SQLite is suitable for this single-instance training deployment but is not shared storage for multiple app instances. For scaled production hosting, move these tables to a managed transactional database before enabling multiple replicas. Authentication token issuance and verified account onboarding must also be connected to the chosen identity provider before users can use protected endpoints.
