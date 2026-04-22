# Environment Variables

Every env var you need, what it's for, and where to get it.

---

## `.env.example`

Put this in the repo root. Real `.env` goes in `.gitignore`.

```bash
# ============================================================
# DATABASE
# ============================================================

# Neon Postgres connection string
# Get from: https://console.neon.tech → Dashboard → Connection Details
DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/throughline?sslmode=require"

# Direct connection for migrations (bypass pooler)
DIRECT_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/throughline?sslmode=require"

# ============================================================
# AUTH (Clerk)
# ============================================================

# Get from: https://dashboard.clerk.com → Your app → API Keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."

# Where Clerk redirects after sign in
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/app"
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/app/onboarding"

# ============================================================
# TWILIO
# ============================================================

# Get from: https://console.twilio.com → Account Info
TWILIO_ACCOUNT_SID="ACxxx..."
TWILIO_AUTH_TOKEN="xxx..."

# Your Messaging Service SID (recommended over raw phone numbers)
# Create at: https://console.twilio.com → Messaging → Services
TWILIO_MESSAGING_SERVICE_SID="MGxxx..."

# Your verified business phone number
TWILIO_FROM_NUMBER="+17045550100"

# ============================================================
# ANTHROPIC
# ============================================================

# Get from: https://console.anthropic.com → API Keys
ANTHROPIC_API_KEY="sk-ant-..."

# Model to use — upgrade as models improve
ANTHROPIC_MODEL="claude-sonnet-4-5"

# ============================================================
# APP CONFIG
# ============================================================

# The public URL of your API — used for Twilio webhook signature verification
PUBLIC_BASE_URL="https://api.throughline.com"

# Frontend URL (for CORS)
PUBLIC_WEB_URL="https://app.throughline.com"

NODE_ENV="development"
PORT=3001

# ============================================================
# OBSERVABILITY (add later)
# ============================================================

# SENTRY_DSN=""
# POSTHOG_API_KEY=""

# ============================================================
# ADMIN
# ============================================================

# Your Clerk user ID — grants PLATFORM_ADMIN role
PLATFORM_ADMIN_CLERK_ID="user_xxx..."
```

---

## Getting each key

### Neon (Postgres) — free
1. Sign up at neon.tech
2. Create project "throughline"
3. Copy the pooled connection string into `DATABASE_URL`
4. Copy the direct connection string into `DIRECT_URL` (for Prisma migrations)

### Clerk — free up to 10K MAU
1. Sign up at clerk.com
2. Create application "ThroughLine"
3. Get keys from Dashboard → API Keys
4. Configure allowed origins in Dashboard → Domains

### Twilio — pay as you go
1. Sign up at twilio.com
2. **Start A2P 10DLC registration immediately** (Dashboard → Messaging → Regulatory Compliance). This takes 1-3 weeks and gates all US B2C SMS.
3. Purchase a phone number (~$1/mo)
4. Create a Messaging Service (bundles numbers, improves deliverability)
5. Copy SID + auth token into `.env`

### Anthropic — pay as you go
1. Sign up at console.anthropic.com
2. Add payment method
3. Create API key
4. Set a monthly spend limit (start with $50)

### Railway (backend host) — $5/mo starter
1. Sign up at railway.app
2. Create project from GitHub repo
3. Add environment variables from above
4. Railway auto-deploys on git push

### Vercel (frontend host) — free
1. Sign up at vercel.com
2. Import GitHub repo
3. Set root to `apps/web`
4. Add environment variables

---

## Secrets hygiene

- **Never commit `.env` to git.** Ever. Check your `.gitignore` has `.env` and `.env.local` before first commit.
- **Rotate keys** if you suspect exposure. Especially Twilio auth token — leaked SMS credentials get abused within minutes.
- **Use different keys per environment.** Dev and prod Clerk apps, dev and prod Twilio numbers.
- **Don't log env vars.** Not even in error handlers.
- **Don't put secrets in URL params.** Headers or body only.

---

## Smoke test checklist

After all env vars are set, run this to verify everything:

```bash
# 1. DB connects
pnpm prisma db pull
# Should show tables in schema

# 2. Clerk auth works
# Visit localhost:3000, sign in, redirect to /app

# 3. Twilio can send
curl -X POST https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json \
  --data-urlencode "To=+1YOUR_PHONE" \
  --data-urlencode "From=$TWILIO_FROM_NUMBER" \
  --data-urlencode "Body=Test from ThroughLine" \
  -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN

# 4. Claude API works
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-5","max_tokens":100,"messages":[{"role":"user","content":"Say hi"}]}'
```

If all four pass, you're ready to build.
