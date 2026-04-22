# Hotel Config Structure

This is the JSON blob stored in `Hotel.config`. The config panel at `/app/config` edits this. The LLM reads this on every SMS to generate contextually accurate replies.

**Design rule:** If a field is going to show up in a guest's message ("what's the wifi?"), it belongs here. If it's operational/staff-only, it doesn't.

---

## Full example

```json
{
  "basics": {
    "checkIn": "4:00 PM",
    "checkOut": "11:00 AM",
    "quietHours": "10:00 PM – 8:00 AM",
    "address": "201 N Tryon St, Charlotte, NC 28202",
    "phone": "+17045550100"
  },

  "wifi": {
    "network": "Bohemian-Guest",
    "password": "artistry2026",
    "notes": "Auto-connects to both bands. No login page required."
  },

  "parking": {
    "valet": {
      "available": true,
      "price": "Complimentary for guests",
      "instructions": "Pull up to the front entrance, our team will handle it."
    },
    "selfPark": {
      "available": true,
      "price": "$18/day",
      "location": "Garage next door"
    }
  },

  "amenities": [
    {
      "name": "Rooftop pool",
      "hours": "7am–10pm",
      "notes": "Heated year-round. Towels provided. 18th floor.",
      "location": "18th floor"
    },
    {
      "name": "Fitness center",
      "hours": "24/7",
      "notes": "Treadmills, Peloton bikes, free weights.",
      "location": "3rd floor",
      "access": "Room key required"
    },
    {
      "name": "Poseidon Spa",
      "hours": "9am–8pm",
      "notes": "Call ext. 6200 to book.",
      "location": "2nd floor"
    }
  ],

  "dining": {
    "onProperty": [
      {
        "name": "The Bohemian",
        "type": "Signature restaurant",
        "cuisine": "Southern-Mediterranean",
        "hours": "6:30am–10pm",
        "notes": "Reservations recommended. Breakfast, lunch, dinner."
      },
      {
        "name": "Skybar",
        "type": "Rooftop lounge",
        "cuisine": "Cocktails, small plates",
        "hours": "4pm–midnight",
        "notes": "18th floor. 21+."
      },
      {
        "name": "Kaffeine",
        "type": "Lobby café",
        "cuisine": "Coffee, pastries, grab-and-go",
        "hours": "6am–6pm"
      }
    ],

    "nearby": [
      {
        "name": "Amélie's French Bakery",
        "distance": "0.3mi",
        "notes": "Open 24 hours. Famous for salted caramel brownies."
      },
      {
        "name": "The Cellar at Duckworth's",
        "distance": "0.2mi",
        "notes": "Speakeasy cocktails, nightcap spot."
      },
      {
        "name": "300 East",
        "distance": "1.1mi",
        "notes": "New American, Dilworth neighborhood."
      }
    ]
  },

  "policies": {
    "lateCheckout": {
      "available": true,
      "options": [
        { "time": "1:00 PM", "fee": "$35" },
        { "time": "3:00 PM", "fee": "$65" }
      ],
      "subjectTo": "availability on day of departure"
    },
    "pets": {
      "allowed": true,
      "fee": "$75/stay",
      "maxWeight": "50 lbs",
      "notes": "Dogs only. Service animals always welcome."
    },
    "smoking": {
      "allowed": false,
      "penalty": "$250 cleaning fee",
      "designatedArea": "Sidewalk courtyard, Tryon St side"
    },
    "cancellation": "24 hours before check-in for full refund"
  },

  "requests": {
    "availableItems": [
      "Extra towels",
      "Extra pillows",
      "Extra blankets",
      "Toiletries",
      "Iron & ironing board",
      "Robe",
      "Hair dryer"
    ],
    "avgDeliveryTime": "10–15 minutes",
    "escalationContact": "ext. 0 from room phone"
  },

  "persona": {
    "tone": "warm, attentive, unobtrusive",
    "examplePhrases": [
      "Of course — I'll take care of that right away.",
      "Happy to help.",
      "Let me know if there's anything else you need."
    ],
    "dontSay": [
      "No problem",
      "Hey!",
      "Sure thing"
    ],
    "signOff": "— Concierge, Grand Bohemian"
  },

  "localContext": {
    "neighborhood": "Uptown Charlotte",
    "walkableTo": ["Discovery Place", "Bank of America Stadium", "Spectrum Center"],
    "rideshareNotes": "Uber/Lyft both ~5 min wait. Hotel has a dedicated pickup zone on College St side."
  }
}
```

---

## What the config panel UI needs to edit

Build it progressively — don't try to expose every field on day one.

**Phase 1 (must have):**
- Basics (check-in, check-out, address, phone)
- WiFi (network, password)
- Parking (valet + self-park)
- Late checkout policy
- Available request items

**Phase 2 (nice to have):**
- Amenities list (add/edit/remove)
- Dining (on-property + nearby)
- Policies (pets, smoking, cancellation)

**Phase 3 (advanced):**
- Persona customization (tone, example phrases)
- Local context / neighborhood

For v1, a single page with collapsible sections is fine. Don't build a tabbed wizard.

---

## Validation

Use Zod to validate the config shape before saving. Example:

```typescript
import { z } from 'zod';

const HotelConfigSchema = z.object({
  basics: z.object({
    checkIn: z.string(),
    checkOut: z.string(),
    address: z.string(),
    phone: z.string().regex(/^\+1\d{10}$/),
  }),
  wifi: z.object({
    network: z.string().min(1),
    password: z.string().min(1),
    notes: z.string().optional(),
  }),
  // ... rest
});

export type HotelConfig = z.infer<typeof HotelConfigSchema>;
```

Put this in `packages/types/src/hotel-config.ts` so backend and frontend share it.
