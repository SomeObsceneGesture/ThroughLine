# Twilio SMS Webhook — Implementation Notes

This is the most important file in the build. Get this right and everything else works. Get it wrong and guests get wrong answers, duplicated replies, or nothing at all.

---

## The full flow

```
Guest sends SMS
      ↓
Twilio receives on hotel's number
      ↓
Twilio POSTs to /api/sms/inbound
      ↓
1. Verify signature (reject if invalid)
2. Find Hotel by `To` number
3. Find or create Guest by `From` number
4. Find or create open Conversation
5. Save inbound Message
6. Load hotel config + last 10 messages
7. Call Claude API with structured output
8. Parse response: { reply, create_request? }
9. Save outbound Message
10. If request, insert into Request table
11. Send reply via Twilio
12. Return 200 with empty TwiML
      ↓
Guest receives reply on their phone
```

**Total budget: <3 seconds.** Twilio will retry if you take too long.

---

## Endpoint scaffold

```typescript
// apps/api/src/routes/sms.ts
import { Router } from 'express';
import twilio from 'twilio';
import { db } from '@throughline/db';
import { generateConciergeReply } from '../lib/concierge';

const router = Router();

router.post('/inbound', async (req, res) => {
  // ============================================================
  // 1. VERIFY SIGNATURE — never skip this
  // ============================================================
  const signature = req.headers['x-twilio-signature'] as string;
  const url = `${process.env.PUBLIC_BASE_URL}/api/sms/inbound`;
  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    signature,
    url,
    req.body
  );
  if (!valid) {
    return res.status(403).send('Invalid signature');
  }

  // ============================================================
  // 2. Extract Twilio params
  // ============================================================
  const from = req.body.From as string;        // guest's number
  const to = req.body.To as string;            // hotel's Twilio number
  const body = req.body.Body as string;
  const messageSid = req.body.MessageSid as string;

  // Idempotency: if we've already processed this SID, don't re-reply
  const existing = await db.message.findFirst({ where: { twilioSid: messageSid } });
  if (existing) {
    return res.type('text/xml').send('<Response></Response>');
  }

  try {
    // ============================================================
    // 3. Resolve hotel
    // ============================================================
    const hotel = await db.hotel.findUnique({ where: { twilioNumber: to } });
    if (!hotel) {
      console.error(`No hotel found for Twilio number ${to}`);
      return res.status(200).type('text/xml').send('<Response></Response>');
    }

    // ============================================================
    // 4. Find or create guest + conversation
    // ============================================================
    const guest = await db.guest.upsert({
      where: { hotelId_phone: { hotelId: hotel.id, phone: from } },
      create: { hotelId: hotel.id, phone: from },
      update: {},
    });

    let conversation = await db.conversation.findFirst({
      where: { guestId: guest.id, closedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!conversation) {
      conversation = await db.conversation.create({
        data: { hotelId: hotel.id, guestId: guest.id },
      });
    }

    // ============================================================
    // 5. Save inbound message
    // ============================================================
    await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        body,
        twilioSid: messageSid,
      },
    });

    // ============================================================
    // 6. Generate reply via Claude
    // ============================================================
    const { reply, request, intent, usage } = await generateConciergeReply({
      hotel,
      guest,
      conversation,
      incomingMessage: body,
    });

    // ============================================================
    // 7. Save outbound message + optional request
    // ============================================================
    await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        body: reply,
        intent,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        costUsd: calculateCost(usage),
      },
    });

    if (request) {
      await db.request.create({
        data: {
          hotelId: hotel.id,
          guestId: guest.id,
          type: request.type,
          title: request.title,
          body: request.body,
          priority: request.priority,
          room: guest.room,
          source: 'SMS',
        },
      });
    }

    // ============================================================
    // 8. Send reply via TwiML
    // ============================================================
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);
    return res.type('text/xml').send(twiml.toString());

  } catch (err) {
    console.error('SMS webhook error:', err);
    // Graceful fallback — guest gets a message, not silence
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "Sorry, we're having a technical issue. Please call the front desk directly or dial 0 from your room phone."
    );
    return res.type('text/xml').send(twiml.toString());
  }
});

export default router;

function calculateCost(usage: { input_tokens: number; output_tokens: number }) {
  // Claude Sonnet 4.5 pricing — update if model changes
  const inputCost = (usage.input_tokens / 1_000_000) * 3;
  const outputCost = (usage.output_tokens / 1_000_000) * 15;
  return inputCost + outputCost;
}
```

---

## Concierge generation function

```typescript
// apps/api/src/lib/concierge.ts
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@throughline/db';
import { buildSystemPrompt } from './system-prompt';
import type { Hotel, Guest, Conversation } from '@prisma/client';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateConciergeReply(args: {
  hotel: Hotel;
  guest: Guest;
  conversation: Conversation;
  incomingMessage: string;
}) {
  const { hotel, guest, conversation, incomingMessage } = args;

  // Load recent messages for context (last 10)
  const recentMessages = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const messageHistory = recentMessages
    .reverse()
    .map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' as const : 'assistant' as const,
      content: m.body,
    }));

  messageHistory.push({ role: 'user', content: incomingMessage });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: buildSystemPrompt(hotel, guest),
    messages: messageHistory,
    tools: [
      {
        name: 'reply_to_guest',
        description: 'Send a text reply to the guest. Optionally create a service request.',
        input_schema: {
          type: 'object',
          properties: {
            reply: {
              type: 'string',
              description: 'The SMS reply text. Keep under 320 chars for single-message delivery.',
            },
            intent: {
              type: 'string',
              enum: ['wifi', 'parking', 'checkout', 'checkin', 'amenity_info', 'dining',
                     'request_item', 'request_service', 'complaint', 'chitchat', 'other'],
            },
            create_request: {
              type: 'object',
              description: 'Create a service request for staff. Only when guest is asking for something physical.',
              properties: {
                type: {
                  type: 'string',
                  enum: ['TOWELS', 'PILLOWS', 'BLANKETS', 'HOUSEKEEPING', 'MAINTENANCE',
                         'VALET', 'LATE_CHECKOUT', 'DINING_RESERVATION', 'SPA_BOOKING',
                         'NOISE_COMPLAINT', 'OTHER'],
                },
                title: { type: 'string', description: 'Short summary, e.g. "2 extra towels to 412"' },
                body: { type: 'string', description: 'Full context for staff' },
                priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] },
              },
              required: ['type', 'title', 'priority'],
            },
          },
          required: ['reply', 'intent'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'reply_to_guest' },
  });

  // Extract tool use result
  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('Claude did not return a tool use');
  }

  const parsed = toolUse.input as {
    reply: string;
    intent: string;
    create_request?: {
      type: string;
      title: string;
      body?: string;
      priority: string;
    };
  };

  return {
    reply: parsed.reply,
    intent: parsed.intent,
    request: parsed.create_request,
    usage: response.usage,
  };
}
```

---

## Local testing before you deploy

You cannot test webhooks against `localhost`. Use **ngrok** or **Cloudflare Tunnel**:

```bash
# Terminal 1: your API
pnpm dev

# Terminal 2: tunnel
ngrok http 3001
# Note the https://xxx.ngrok.io URL
```

Set your Twilio number's webhook URL to `https://xxx.ngrok.io/api/sms/inbound` in the Twilio console. Text your Twilio number from your phone. Watch logs.

---

## Rate limiting

Add per-phone rate limit so a broken guest phone (or bad actor) can't burn through your API credits:

```typescript
import rateLimit from 'express-rate-limit';

const smsLimiter = rateLimit({
  windowMs: 60 * 1000,           // 1 minute
  max: 10,                        // 10 messages per minute per phone
  keyGenerator: (req) => req.body.From,
  message: { error: 'Too many messages — please wait.' },
});

router.post('/inbound', smsLimiter, async (req, res) => { ... });
```

---

## Critical edge cases to handle before launch

1. **Multi-part SMS.** Long messages arrive as multiple webhooks with the same `MessageSid` prefix. Twilio reassembles if you use their API correctly. Don't worry about this for v1 — cap outbound replies at 320 chars.

2. **MMS (picture messages).** Guest sends a photo of the broken thing. For v1, reply "Thanks — I've alerted maintenance and shared your message. They'll be up shortly" and create a maintenance request with the image URL stored in `body`.

3. **Wrong number / ghost texts.** Guest texts "hi" out of context. The LLM should reply warmly and ask how it can help. No request created.

4. **Emergency content.** If the LLM detects "fire," "medical emergency," "police" — reply with local emergency number (911) *and* hotel extension 0, create URGENT request, trigger staff alert. This is a post-v1 polish item but note it now.

5. **Guest opts out ("STOP"/"UNSUBSCRIBE").** Twilio handles this automatically — you don't need to. But mark the guest's phone as opted out in your DB so you don't accidentally send them any scheduled messages in the future.
