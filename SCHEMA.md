# Database Schema

Drop this into `packages/db/prisma/schema.prisma`. Run `pnpm prisma migrate dev --name init` to create.

---

## Design principles

- **Every business-data table has `hotelId`.** This is the multi-tenancy key. Every query must filter by it. Use Prisma middleware or RLS (Postgres Row-Level Security) to enforce — never trust app code alone.
- **Soft delete with `deletedAt` timestamp**, not hard delete. Hotels will want their data back, and you'll want the audit trail.
- **JSON fields for flexible config**, structured columns for anything you'll query on.
- **No cascade deletes.** You want to know when you're about to orphan data.

---

## Schema

```prisma
// packages/db/prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// TENANT: Hotel
// ============================================================

model Hotel {
  id             String   @id @default(cuid())
  name           String
  slug           String   @unique              // e.g. "grand-bohemian-charlotte"
  timezone       String   @default("America/New_York")
  twilioNumber   String?  @unique              // E.164 format: +17045551234
  twilioSid      String?                       // Twilio account SID for this number

  // Full hotel config as JSON — see CONFIG_STRUCTURE.md
  config         Json     @default("{}")

  // Subscription / billing (stub for now)
  plan           Plan     @default(TRIAL)
  trialEndsAt    DateTime?

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  // Relations
  staff          Staff[]
  guests         Guest[]
  conversations  Conversation[]
  requests       Request[]
  shiftLogs      ShiftLog[]

  @@index([slug])
  @@index([twilioNumber])
}

enum Plan {
  TRIAL
  STARTER    // up to 50 rooms, $499/mo
  PRO        // up to 150 rooms, $999/mo
  RESORT     // $2k+/mo
  ENTERPRISE // custom
}

// ============================================================
// USERS: Staff (hotel employees)
// ============================================================

model Staff {
  id           String   @id @default(cuid())
  hotelId      String
  hotel        Hotel    @relation(fields: [hotelId], references: [id])

  clerkUserId  String   @unique     // from Clerk auth
  email        String
  name         String
  role         Role     @default(FRONT_DESK)

  shiftLogs    ShiftLog[]
  assignedRequests Request[] @relation("AssignedStaff")

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  deletedAt    DateTime?

  @@index([hotelId])
  @@index([clerkUserId])
}

enum Role {
  OWNER            // hotel owner, sees everything incl. billing
  GM               // general manager, sees everything
  FRONT_DESK       // sees requests, shift log
  HOUSEKEEPING     // sees housekeeping requests only
  MAINTENANCE      // sees maintenance requests only
  PLATFORM_ADMIN   // you, cross-hotel access
}

// ============================================================
// GUESTS (phone-identified, not authenticated)
// ============================================================

model Guest {
  id            String   @id @default(cuid())
  hotelId       String
  hotel         Hotel    @relation(fields: [hotelId], references: [id])

  phone         String                         // E.164 format, hashed for logs
  name          String?                        // optional, may be populated from Opera/PMS
  room          String?
  checkIn       DateTime?
  checkOut      DateTime?

  // Preferences that persist across stays (future: upsell intelligence)
  preferences   Json     @default("{}")

  conversations Conversation[]
  requests      Request[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([hotelId, phone])
  @@index([hotelId])
  @@index([phone])
}

// ============================================================
// CONVERSATIONS + MESSAGES
// ============================================================

model Conversation {
  id        String   @id @default(cuid())
  hotelId   String
  hotel     Hotel    @relation(fields: [hotelId], references: [id])
  guestId   String
  guest     Guest    @relation(fields: [guestId], references: [id])

  // Open until guest has been silent for 24hr or checked out
  closedAt  DateTime?

  messages  Message[]

  createdAt DateTime @default(now())

  @@index([hotelId])
  @@index([guestId])
}

model Message {
  id              String    @id @default(cuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id])

  direction       Direction                     // INBOUND from guest, OUTBOUND from concierge
  body            String    @db.Text
  twilioSid       String?                       // Twilio message SID for dedup/retry

  // Classified intent for analytics (set by LLM or post-processing)
  intent          String?                       // e.g. "wifi", "late_checkout", "towels"

  // Tokens for cost tracking
  inputTokens     Int?
  outputTokens    Int?
  costUsd         Decimal?  @db.Decimal(10, 6)

  createdAt       DateTime  @default(now())

  @@index([conversationId])
  @@index([twilioSid])
}

enum Direction {
  INBOUND
  OUTBOUND
}

// ============================================================
// REQUESTS (the actionable output of conversations)
// ============================================================

model Request {
  id           String   @id @default(cuid())
  hotelId      String
  hotel        Hotel    @relation(fields: [hotelId], references: [id])
  guestId      String?
  guest        Guest?   @relation(fields: [guestId], references: [id])

  type         RequestType
  priority     Priority @default(NORMAL)
  status       RequestStatus @default(OPEN)

  title        String                           // short: "2 extra towels to 412"
  body         String?  @db.Text                // full context
  room         String?

  source       RequestSource @default(SMS)

  assignedToId String?
  assignedTo   Staff?   @relation("AssignedStaff", fields: [assignedToId], references: [id])

  completedAt  DateTime?
  completedBy  String?                          // staff ID who marked complete

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([hotelId, status])
  @@index([hotelId, createdAt])
}

enum RequestType {
  TOWELS
  PILLOWS
  BLANKETS
  HOUSEKEEPING
  MAINTENANCE
  VALET
  LATE_CHECKOUT
  DINING_RESERVATION
  SPA_BOOKING
  NOISE_COMPLAINT
  OTHER
}

enum Priority {
  LOW
  NORMAL
  HIGH
  URGENT    // noise, maintenance, complaints
}

enum RequestStatus {
  OPEN
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

enum RequestSource {
  SMS
  VOICE
  STAFF_ENTRY
  WALK_IN
}

// ============================================================
// SHIFT LOGS (the ThroughLine pass-on feature)
// ============================================================

model ShiftLog {
  id         String   @id @default(cuid())
  hotelId    String
  hotel      Hotel    @relation(fields: [hotelId], references: [id])

  shift      Shift
  date       DateTime @db.Date                  // the shift's date

  agentId    String?
  agent      Staff?   @relation(fields: [agentId], references: [id])

  summary    String?  @db.Text

  // Items as structured JSON array for flexibility
  items      Json     @default("[]")

  openedAt   DateTime @default(now())
  closedAt   DateTime?

  @@unique([hotelId, shift, date])
  @@index([hotelId, date])
}

enum Shift {
  AM
  PM
  OVERNIGHT
}

// ============================================================
// AUDIT LOG (who did what, when)
// ============================================================

model AuditLog {
  id        String   @id @default(cuid())
  hotelId   String?                             // null for platform-level actions

  actorType String                              // "staff", "guest", "system", "platform"
  actorId   String?

  action    String                              // "request.created", "hotel.config.updated"
  targetId  String?
  metadata  Json?

  ip        String?
  userAgent String?

  createdAt DateTime @default(now())

  @@index([hotelId, createdAt])
  @@index([actorId])
}
```

---

## Row-Level Security (Postgres RLS)

After migration, apply this SQL to lock multi-tenancy at the DB layer. This is the belt-and-suspenders against a query that forgets to filter by `hotelId`:

```sql
-- Enable RLS
ALTER TABLE "Guest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShiftLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;

-- Policy: app role can only see rows for the hotel set in session
CREATE POLICY tenant_isolation ON "Guest"
  USING ("hotelId" = current_setting('app.current_hotel_id', true));

-- Repeat for each table.
-- Set in app code: await prisma.$executeRaw`SET app.current_hotel_id = ${hotelId}`;
```

RLS is optional for v1 but add it before you onboard customer #2.

---

## Indexes to add after you have real data

Don't add these yet — Prisma won't know what queries you run until you have traffic. Watch the slow query log in Neon and add indexes as needed. Common ones:

- `Request(hotelId, status, createdAt)` — staff dashboard "open requests today"
- `Message(conversationId, createdAt DESC)` — load last N messages for LLM context
- `Guest(hotelId, checkOut)` — find guests currently staying

---

## Seeds

For local dev, seed one hotel + one staff + one guest:

```typescript
// packages/db/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  const hotel = await db.hotel.upsert({
    where: { slug: 'grand-bohemian-charlotte' },
    create: {
      name: 'Grand Bohemian Charlotte',
      slug: 'grand-bohemian-charlotte',
      timezone: 'America/New_York',
      twilioNumber: '+17045550100',  // placeholder
      config: {
        wifi: { network: 'Bohemian-Guest', password: 'artistry2026' },
        checkIn: '4:00 PM',
        checkOut: '11:00 AM',
        // ... see CONFIG_STRUCTURE.md
      },
    },
    update: {},
  });

  await db.staff.upsert({
    where: { clerkUserId: 'dev_jesse' },
    create: {
      clerkUserId: 'dev_jesse',
      hotelId: hotel.id,
      email: 'jesse@grandbohemian.example',
      name: 'Jesse Szemkus',
      role: 'FRONT_DESK',
    },
    update: {},
  });
}

main().catch(console.error).finally(() => db.$disconnect());
```

Run: `pnpm prisma db seed`
