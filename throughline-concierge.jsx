import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Sparkles, Wifi, Car, Utensils, Clock, BedDouble, Phone,
  ChevronLeft, MoreVertical, Check, CheckCheck, MapPin, Coffee,
  Sun, Moon, Plus, X, AlertCircle, CircleDot
} from 'lucide-react';

export default function ThroughLineConcierge() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const [activeRequest, setActiveRequest] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Load from localStorage-equivalent (in-memory for artifact constraint)
  // In production: swap to localStorage or server-side persistence
  const [hasGreeted, setHasGreeted] = useState(false);

  const spring = { type: 'spring', stiffness: 380, damping: 32 };
  const softSpring = { type: 'spring', stiffness: 260, damping: 28 };

  // ============================================================
  // HOTEL KNOWLEDGE BASE (in production: system prompt to LLM)
  // ============================================================
  const hotel = {
    name: 'Grand Bohemian',
    location: 'Charlotte, NC',
    guest: { name: 'Mr. Henderson', room: '412' },
    checkIn: '4:00 PM',
    checkOut: '11:00 AM',
    lateCheckout: 'Available until 1:00 PM for $35, or until 3:00 PM for $65',
    wifi: { network: 'Bohemian-Guest', password: 'artistry2026' },
    parking: 'Valet parking is complimentary for guests. Pull up to the front entrance — our team will take it from there. Self-park garage next door is $18/day.',
    pool: 'Rooftop pool open 7am–10pm, heated year-round',
    gym: '24-hour fitness center on floor 3, access with your room key',
    spa: 'Poseidon Spa on floor 2 · 9am–8pm · call ext. 6200 to book',
    dining: [
      { name: 'The Bohemian', type: 'Signature restaurant', hours: '6:30am–10pm', note: 'Southern-Mediterranean, reservations recommended' },
      { name: 'Skybar', type: 'Rooftop lounge', hours: '4pm–midnight', note: 'Cocktails and small plates, 18th floor' },
      { name: 'Kaffeine', type: 'Lobby café', hours: '6am–6pm', note: 'Locally roasted coffee, pastries, grab-and-go' },
    ],
    nearby: [
      { name: 'Amélie\'s French Bakery', dist: '0.3mi', note: 'Open 24 hours, legendary salted caramel brownies' },
      { name: 'The Cellar at Duckworth\'s', dist: '0.2mi', note: 'Speakeasy cocktails, great for a nightcap' },
      { name: '300 East', dist: '1.1mi', note: 'New American, cozy Dilworth neighborhood favorite' },
      { name: 'NoDa Arts District', dist: '2.4mi', note: 'Breweries, galleries, live music — worth the short Uber' },
    ],
  };

  // ============================================================
  // RESPONSE ENGINE (swap for LLM API call in production)
  // ============================================================
  const getConciergeResponse = (userMessage) => {
    const msg = userMessage.toLowerCase();

    // Intent detection
    if (/wifi|wi-fi|internet|password|network/.test(msg)) {
      return {
        text: `Here's what you need for WiFi:\n\nNetwork: **${hotel.wifi.network}**\nPassword: **${hotel.wifi.password}**\n\nIt connects automatically to both bands — no login page. Let me know if you have trouble getting on.`,
        actions: []
      };
    }

    if (/park|valet|car|garage/.test(msg)) {
      return {
        text: hotel.parking + '\n\nWant me to call for your car when you\'re heading out? Just let me know about 10 minutes ahead.',
        actions: [{ label: 'Request my car', intent: 'request_valet' }]
      };
    }

    if (/check[- ]?out|checkout|leaving|depart/.test(msg)) {
      if (/late/.test(msg) || /extend/.test(msg)) {
        return {
          text: `Late checkout — happy to help. ${hotel.lateCheckout}\n\nBoth are subject to availability on your day of departure. Want me to request one for you?`,
          actions: [
            { label: 'Request 1pm late checkout', intent: 'request_late_checkout_1pm' },
            { label: 'Request 3pm late checkout', intent: 'request_late_checkout_3pm' },
          ]
        };
      }
      return {
        text: `Standard checkout is **${hotel.checkOut}**. You can use express checkout from the TV menu, or just drop your keys at the front desk on your way out.\n\nNeed a late checkout?`,
        actions: [{ label: 'Yes, request late checkout', intent: 'ask_late_checkout' }]
      };
    }

    if (/check[- ]?in/.test(msg)) {
      return {
        text: `Check-in is **${hotel.checkIn}**. If you arrive earlier and your room is ready, we'll get you in sooner — we can also hold your bags at the front desk in the meantime.`,
        actions: []
      };
    }

    if (/towel|extra.*(towel|pillow|blanket|sheet)/.test(msg) || /pillow/.test(msg)) {
      const item = /pillow/.test(msg) ? 'pillows' : /blanket/.test(msg) ? 'blankets' : 'towels';
      return {
        text: `No problem — I'll send extra ${item} to room ${hotel.guest.room} right away. Usually about 10–15 minutes. How many do you need?`,
        actions: [
          { label: `Send 2 extra ${item}`, intent: `request_${item}_2` },
          { label: `Send 4 extra ${item}`, intent: `request_${item}_4` },
        ]
      };
    }

    if (/housekeep|cleaning|clean.*(room)|tidy/.test(msg)) {
      return {
        text: `I can schedule housekeeping for you. When would you like them to come by?`,
        actions: [
          { label: 'As soon as possible', intent: 'request_housekeeping_asap' },
          { label: 'After I leave for the day', intent: 'request_housekeeping_later' },
          { label: 'Just refresh towels', intent: 'request_towels_2' },
        ]
      };
    }

    if (/restaurant|eat|dinner|lunch|breakfast|food|dining/.test(msg)) {
      if (/nearby|outside|around|close|walking/.test(msg)) {
        return {
          text: `A few favorites within walking distance:\n\n${hotel.nearby.slice(0, 3).map(p => `• **${p.name}** (${p.dist}) — ${p.note}`).join('\n')}\n\nWant me to tell you more about any of these, or help with a reservation?`,
          actions: []
        };
      }
      return {
        text: `We have three places on-property:\n\n${hotel.dining.map(d => `• **${d.name}** (${d.hours}) — ${d.note}`).join('\n')}\n\nAnything catch your eye?`,
        actions: [
          { label: 'Reserve at The Bohemian', intent: 'reserve_bohemian' },
          { label: 'Places near the hotel', intent: 'nearby_dining' },
        ]
      };
    }

    if (/pool|swim|rooftop/.test(msg)) {
      return { text: `The **rooftop pool** is open ${hotel.pool}. Towels are provided up there, and the bar service runs from 11am onward. Take the elevator to the 18th floor.`, actions: [] };
    }

    if (/gym|fitness|workout|exercise/.test(msg)) {
      return { text: hotel.gym + '. Treadmills, Peloton bikes, free weights, and a stretching area. Just tap your room key on the door sensor.', actions: [] };
    }

    if (/spa|massage|treatment/.test(msg)) {
      return { text: hotel.spa + '. I can call ahead for you if you\'d like — what kind of treatment are you thinking?', actions: [{ label: 'Connect me with the spa', intent: 'contact_spa' }] };
    }

    if (/coffee|café|cafe|morning/.test(msg)) {
      return { text: `**Kaffeine** in the lobby opens at 6am — locally roasted, proper espresso, pastries. There's also a Nespresso in your room with a few pods on the dresser. Want a pot of coffee brought up?`, actions: [{ label: 'Send coffee to my room', intent: 'request_coffee' }] };
    }

    if (/noise|loud|quiet|neighbor/.test(msg)) {
      return { text: `I'm sorry about the disturbance — that's not the experience we want for you. I'll flag this for our overnight manager right now so they can look into it.`, actions: [{ label: 'Yes, notify the manager', intent: 'escalate_noise', urgent: true }] };
    }

    if (/broken|not.*(work|turn)|leak|smell|dirty|maintenance|fix/.test(msg)) {
      return {
        text: `I'll get maintenance up to your room. Can you tell me a bit more about what's going on? The more detail the better — our team will come prepared.`,
        actions: [
          { label: 'Send maintenance now', intent: 'request_maintenance', urgent: true }
        ]
      };
    }

    if (/thank|thanks|appreciate|great|awesome|perfect|excellent/.test(msg)) {
      return { text: `You're very welcome. Enjoy the rest of your stay — I'm here whenever you need anything.`, actions: [] };
    }

    if (/hello|hi\b|hey|good morning|good afternoon|good evening/.test(msg)) {
      return { text: `Hello! How can I help make your stay better?`, actions: [] };
    }

    // Default fallback
    return {
      text: `I want to make sure I help with the right thing. Could you tell me a little more, or pick one of these?`,
      actions: [
        { label: 'Hotel amenities', intent: 'ask_amenities' },
        { label: 'Nearby recommendations', intent: 'nearby_dining' },
        { label: 'Request something to my room', intent: 'ask_request' },
        { label: 'Speak to a human', intent: 'contact_human' },
      ]
    };
  };

  // Handle action button clicks (request intents)
  const handleActionIntent = (action) => {
    const intent = action.intent;
    let confirmText = '';
    let requestTitle = '';

    if (intent.startsWith('request_valet')) {
      confirmText = `Got it — I've asked valet to have your car ready in about 10 minutes. They'll pull up to the front entrance.`;
      requestTitle = 'Valet requested';
    } else if (intent === 'request_late_checkout_1pm') {
      confirmText = `Done. I've requested 1pm late checkout for you — the front desk will confirm availability and text you shortly. The $35 fee will be added to your folio.`;
      requestTitle = 'Late checkout · 1pm requested';
    } else if (intent === 'request_late_checkout_3pm') {
      confirmText = `Done. I've requested 3pm late checkout for you — the front desk will confirm availability and text you shortly. The $65 fee will be added to your folio.`;
      requestTitle = 'Late checkout · 3pm requested';
    } else if (intent === 'ask_late_checkout') {
      return sendConciergeMessage({
        text: `${hotel.lateCheckout}\n\nWant me to request one?`,
        actions: [
          { label: '1pm late checkout', intent: 'request_late_checkout_1pm' },
          { label: '3pm late checkout', intent: 'request_late_checkout_3pm' },
        ]
      });
    } else if (intent.startsWith('request_towels') || intent.startsWith('request_pillows') || intent.startsWith('request_blankets')) {
      const [, item, count] = intent.split('_');
      confirmText = `On the way — ${count} extra ${item} heading to room ${hotel.guest.room}. Should be there in 10–15 minutes.`;
      requestTitle = `${count} extra ${item}`;
    } else if (intent === 'request_housekeeping_asap') {
      confirmText = `Housekeeping is on the way — usually within 20 minutes. Is there anything specific you'd like them to focus on?`;
      requestTitle = 'Housekeeping requested';
    } else if (intent === 'request_housekeeping_later') {
      confirmText = `Got it — I've scheduled housekeeping to come by after you leave. They'll check for the Do Not Disturb sign first.`;
      requestTitle = 'Housekeeping scheduled';
    } else if (intent === 'request_coffee') {
      confirmText = `A fresh pot is on its way to room ${hotel.guest.room}. Milk and sugar included — let me know if you want pastries or anything else.`;
      requestTitle = 'Coffee requested';
    } else if (intent === 'request_maintenance' || intent === 'escalate_noise') {
      confirmText = intent === 'request_maintenance'
        ? `Maintenance has been notified with priority status. Someone will knock within 15 minutes — if they miss you, they'll text first.`
        : `Our overnight manager has been alerted and will look into this right away. You'll get a text within 10 minutes with an update.`;
      requestTitle = intent === 'request_maintenance' ? 'Maintenance · priority' : 'Noise complaint · manager alerted';
    } else if (intent === 'reserve_bohemian') {
      confirmText = `I've sent a reservation request to The Bohemian. They'll text you shortly to confirm time and party size. What time were you thinking?`;
      requestTitle = 'Dinner reservation · The Bohemian';
    } else if (intent === 'contact_spa') {
      confirmText = `Connecting you with the spa now — they'll text you within a couple minutes to help you book.`;
      requestTitle = 'Spa inquiry';
    } else if (intent === 'contact_human') {
      confirmText = `A member of our front desk team will be with you in just a moment. You can also reach us anytime at extension 0 from your room phone.`;
      requestTitle = 'Connecting to front desk';
    } else if (intent === 'nearby_dining') {
      return sendConciergeMessage({
        text: `A few favorites within walking distance:\n\n${hotel.nearby.map(p => `• **${p.name}** (${p.dist}) — ${p.note}`).join('\n')}\n\nWant directions to any of these?`,
        actions: []
      });
    } else if (intent === 'ask_amenities') {
      return sendConciergeMessage({
        text: `Here's what we have on-property:\n\n• Rooftop pool (7am–10pm, heated)\n• 24-hour fitness center\n• Poseidon Spa (9am–8pm)\n• Three restaurants\n• Valet parking\n• Concierge — that's me\n\nWhat would you like to know more about?`,
        actions: []
      });
    } else if (intent === 'ask_request') {
      return sendConciergeMessage({
        text: `I can send anything you need up to your room. What would help?`,
        actions: [
          { label: 'Extra towels', intent: 'request_towels_2' },
          { label: 'Extra pillows', intent: 'request_pillows_2' },
          { label: 'Coffee', intent: 'request_coffee' },
          { label: 'Housekeeping', intent: 'request_housekeeping_asap' },
        ]
      });
    } else {
      confirmText = `Got it — I'll take care of that right away.`;
      requestTitle = 'Request submitted';
    }

    // Show confirmation toast + add message
    if (requestTitle) {
      setActiveRequest({ title: requestTitle, time: new Date() });
      setTimeout(() => setActiveRequest(null), 4000);
    }

    sendConciergeMessage({ text: confirmText, actions: [], confirmed: true });
  };

  // Add a concierge message (simulates typing delay)
  const sendConciergeMessage = ({ text, actions = [], confirmed = false }) => {
    setIsTyping(true);
    const typingDuration = Math.min(800 + text.length * 8, 2200);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now() + Math.random(),
        role: 'concierge',
        text,
        actions,
        confirmed,
        time: new Date()
      }]);
    }, typingDuration);
  };

  // Send user message and trigger response
  const handleSend = (textOverride) => {
    const text = (textOverride ?? input).trim();
    if (!text) return;
    setShowQuickActions(false);
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: 'user',
      text,
      time: new Date()
    }]);
    setInput('');

    const response = getConciergeResponse(text);
    sendConciergeMessage(response);
  };

  // Initial greeting
  useEffect(() => {
    if (!hasGreeted) {
      setHasGreeted(true);
      setTimeout(() => {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          setMessages([{
            id: 'greet',
            role: 'concierge',
            text: `Welcome to the Grand Bohemian, ${hotel.guest.name}. I'm your concierge — I can answer questions, send things up to room ${hotel.guest.room}, make reservations, or just help you find your way around Charlotte.\n\nWhat can I do for you?`,
            actions: [],
            time: new Date()
          }]);
        }, 1400);
      }, 600);
    }
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isTyping]);

  const quickActions = [
    { icon: Wifi, label: 'WiFi password', query: 'What\'s the wifi password?' },
    { icon: Clock, label: 'Late checkout', query: 'Can I get a late checkout?' },
    { icon: Utensils, label: 'Dinner nearby', query: 'Where should I eat nearby?' },
    { icon: Coffee, label: 'Coffee to room', query: 'Can you send coffee to my room?' },
    { icon: BedDouble, label: 'Extra towels', query: 'Can I get extra towels?' },
    { icon: Car, label: 'My car', query: 'I\'d like to get my car please' },
  ];

  // Format timestamp
  const formatTime = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // Render message text with bold support
  const renderText = (text) => {
    return text.split('\n').map((line, i) => (
      <span key={i}>
        {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
          }
          return <span key={j}>{part}</span>;
        })}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    ));
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{
      background: 'radial-gradient(ellipse at top, #2a1f17 0%, #0f0a07 60%, #000 100%)'
    }}>
      <style>{`
        @import url('https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

        body, * {
          font-family: 'General Sans', -apple-system, 'Segoe UI', sans-serif;
        }

        .font-mono { font-family: 'JetBrains Mono', monospace; }

        /* Phone frame */
        .phone-frame {
          background: #1a1511;
          border-radius: 48px;
          padding: 14px;
          box-shadow:
            0 0 0 2px #2a231c,
            0 30px 80px rgba(0,0,0,0.6),
            0 10px 30px rgba(0,0,0,0.4);
        }
        .phone-screen {
          background: #fbf6ef;
          border-radius: 36px;
          overflow: hidden;
          position: relative;
          width: 380px;
          height: 780px;
        }

        /* Notch */
        .notch {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          width: 110px;
          height: 28px;
          background: #1a1511;
          border-radius: 999px;
          z-index: 60;
        }

        /* Message bubble tail via border-radius tricks */
        .bubble-user {
          background: linear-gradient(180deg, #c97754 0%, #b8633f 100%);
          color: #fff8ef;
          border-radius: 20px 20px 6px 20px;
          box-shadow: 0 1px 2px rgba(184, 99, 63, 0.2);
        }
        .bubble-concierge {
          background: #ffffff;
          color: #1a1511;
          border-radius: 20px 20px 20px 6px;
          border: 1px solid #ece5d9;
          box-shadow: 0 1px 2px rgba(26, 21, 17, 0.03);
        }
        .bubble-confirmed {
          background: #f4ebe0;
          color: #1a1511;
          border-radius: 20px;
          border: 1px solid #e0d3bd;
        }

        /* Typing dots */
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .typing-dot {
          animation: typing-bounce 1.2s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.15s; }
        .typing-dot:nth-child(3) { animation-delay: 0.3s; }

        /* Scrollbar hide */
        .scroll-hide::-webkit-scrollbar { display: none; }
        .scroll-hide { -ms-overflow-style: none; scrollbar-width: none; }

        /* Ambient pulse for live indicator */
        @keyframes ambient { 0%, 100% { opacity: 0.4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.2); } }
        .ambient { animation: ambient 2.4s ease-in-out infinite; }

        /* Quick action hover */
        .qa-button {
          transition: transform 0.15s ease, background 0.15s ease;
        }
        .qa-button:active {
          transform: scale(0.97);
        }
      `}</style>

      {/* Device frame for preview */}
      <div className="phone-frame">
        <div className="notch" />
        <div className="phone-screen flex flex-col">

          {/* Status bar (faux iOS) */}
          <div className="flex items-center justify-between px-6 pt-3 pb-1 text-[13px] font-semibold" style={{ color: '#1a1511' }}>
            <span className="font-mono">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })}</span>
            <div className="flex items-center gap-1">
              <div className="flex items-end gap-0.5">
                <div className="w-0.5 h-1.5 bg-current rounded-sm" />
                <div className="w-0.5 h-2 bg-current rounded-sm" />
                <div className="w-0.5 h-2.5 bg-current rounded-sm" />
                <div className="w-0.5 h-3 bg-current rounded-sm" />
              </div>
              <svg className="w-3.5 h-3 ml-1" viewBox="0 0 16 12" fill="currentColor">
                <path d="M8 1.5C5.5 1.5 3.3 2.5 1.5 4.2l1.2 1.2C4.2 4 6 3.2 8 3.2s3.8.8 5.3 2.2l1.2-1.2C12.7 2.5 10.5 1.5 8 1.5zm0 3.3c-1.5 0-2.9.6-4 1.6l1.2 1.2c.8-.7 1.8-1.1 2.8-1.1s2 .4 2.8 1.1l1.2-1.2c-1.1-1-2.5-1.6-4-1.6zm0 3.3c-.7 0-1.3.3-1.8.7L8 10.5l1.8-1.7c-.5-.4-1.1-.7-1.8-.7z" />
              </svg>
              <div className="ml-1 w-6 h-3 border rounded-sm relative" style={{ borderColor: 'currentColor' }}>
                <div className="absolute inset-0.5 rounded-sm bg-current" style={{ width: '75%' }} />
                <div className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-1.5 bg-current rounded-r-sm" />
              </div>
            </div>
          </div>

          {/* Concierge header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={softSpring}
            className="px-5 py-3 flex items-center gap-3 border-b"
            style={{ background: '#fbf6ef', borderColor: '#ece5d9' }}
          >
            <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#f4ebe0' }}>
              <ChevronLeft className="w-4 h-4" style={{ color: '#1a1511' }} />
            </button>

            <div className="flex items-center gap-3 flex-1">
              <div className="relative">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{
                  background: 'linear-gradient(135deg, #c97754, #8a4a2e)'
                }}>
                  <Sparkles className="w-4 h-4" style={{ color: '#fff8ef' }} strokeWidth={2} />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{
                  background: '#5c8a6f', borderColor: '#fbf6ef'
                }} />
              </div>
              <div className="leading-tight">
                <div className="text-[15px] font-semibold" style={{ color: '#1a1511' }}>Concierge</div>
                <div className="text-[11px] flex items-center gap-1" style={{ color: '#7a6d5a' }}>
                  <span>Grand Bohemian</span>
                  <span>·</span>
                  <span>Online</span>
                </div>
              </div>
            </div>

            <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: '#f4ebe0' }}>
              <Phone className="w-4 h-4" style={{ color: '#1a1511' }} />
            </button>
          </motion.div>

          {/* Messages scroll area */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto scroll-hide px-4 py-4 space-y-3"
            style={{ background: '#fbf6ef' }}
          >
            {/* Welcome hero — shown once */}
            {messages.length === 0 && !isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{
                  background: 'linear-gradient(135deg, #c97754, #8a4a2e)',
                  boxShadow: '0 8px 24px rgba(201, 119, 84, 0.3)'
                }}>
                  <Sparkles className="w-6 h-6 text-white" strokeWidth={1.75} />
                </div>
                <div className="text-[13px] font-mono tracking-wider uppercase mb-1" style={{ color: '#7a6d5a' }}>
                  Room {hotel.guest.room}
                </div>
                <div className="text-[22px] font-semibold leading-tight" style={{ color: '#1a1511', letterSpacing: '-0.02em' }}>
                  How can I help?
                </div>
              </motion.div>
            )}

            {/* Messages */}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showTime = !prev || (m.time - prev.time > 5 * 60 * 1000) || prev.role !== m.role;
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={spring}
                    className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    {showTime && (
                      <div className="text-[10px] font-mono mb-1 px-2" style={{ color: '#a8998a' }}>
                        {formatTime(m.time)}
                      </div>
                    )}

                    {m.confirmed ? (
                      <div className="bubble-confirmed max-w-[85%] px-4 py-3 flex items-start gap-2.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: '#5c8a6f' }}>
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </div>
                        <div className="text-[14px] leading-relaxed">{renderText(m.text)}</div>
                      </div>
                    ) : (
                      <div className={`max-w-[85%] px-4 py-2.5 ${m.role === 'user' ? 'bubble-user' : 'bubble-concierge'}`}>
                        <div className="text-[14px] leading-relaxed whitespace-pre-wrap">{renderText(m.text)}</div>
                      </div>
                    )}

                    {/* Action buttons */}
                    {m.actions && m.actions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...softSpring, delay: 0.2 }}
                        className="flex flex-wrap gap-1.5 mt-2 max-w-[85%]"
                      >
                        {m.actions.map((a, j) => (
                          <motion.button
                            key={j}
                            whileHover={{ y: -1 }}
                            whileTap={{ scale: 0.96 }}
                            transition={spring}
                            onClick={() => handleActionIntent(a)}
                            className="px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                            style={{
                              background: a.urgent ? '#1a1511' : '#ffffff',
                              color: a.urgent ? '#fff8ef' : '#1a1511',
                              border: a.urgent ? 'none' : '1px solid #e0d3bd'
                            }}
                          >
                            {a.label}
                          </motion.button>
                        ))}
                      </motion.div>
                    )}

                    {/* Read receipt for user messages */}
                    {m.role === 'user' && i === messages.length - 1 && !isTyping && (
                      <div className="text-[10px] mt-1 px-2 flex items-center gap-1" style={{ color: '#a8998a' }}>
                        <CheckCheck className="w-3 h-3" />
                        <span>Read</span>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Typing indicator */}
            <AnimatePresence>
              {isTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring}
                  className="flex items-center"
                >
                  <div className="bubble-concierge px-4 py-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full typing-dot" style={{ background: '#7a6d5a' }} />
                    <span className="w-1.5 h-1.5 rounded-full typing-dot" style={{ background: '#7a6d5a' }} />
                    <span className="w-1.5 h-1.5 rounded-full typing-dot" style={{ background: '#7a6d5a' }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Quick actions grid — shown until first user message */}
            <AnimatePresence>
              {showQuickActions && messages.length > 0 && !isTyping && messages.length <= 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ ...softSpring, delay: 0.3 }}
                  className="pt-2"
                >
                  <div className="text-[10px] font-mono tracking-wider uppercase mb-2 px-1" style={{ color: '#a8998a' }}>
                    Popular
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {quickActions.map((qa, i) => (
                      <motion.button
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...softSpring, delay: 0.4 + i * 0.06 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleSend(qa.query)}
                        className="qa-button flex items-center gap-2 px-3 py-2.5 rounded-xl text-left"
                        style={{
                          background: '#ffffff',
                          border: '1px solid #ece5d9'
                        }}
                      >
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#f4ebe0' }}>
                          <qa.icon className="w-3.5 h-3.5" style={{ color: '#8a4a2e' }} strokeWidth={2} />
                        </div>
                        <span className="text-[12px] font-medium leading-tight" style={{ color: '#1a1511' }}>
                          {qa.label}
                        </span>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Input bar */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ ...softSpring, delay: 0.2 }}
            className="px-4 py-3 border-t"
            style={{ background: '#fbf6ef', borderColor: '#ece5d9' }}
          >
            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.9, rotate: 45 }}
                transition={spring}
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: '#f4ebe0', color: '#1a1511' }}
                onClick={() => setShowQuickActions(!showQuickActions)}
              >
                <Plus className="w-4 h-4" strokeWidth={2.5} />
              </motion.button>

              <div className="flex-1 flex items-center gap-2 px-3.5 rounded-full h-10" style={{
                background: '#ffffff', border: '1px solid #ece5d9'
              }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                  placeholder="Ask me anything..."
                  className="flex-1 bg-transparent outline-none text-[14px]"
                  style={{ color: '#1a1511' }}
                />
              </div>

              <AnimatePresence mode="wait">
                {input.trim() ? (
                  <motion.button
                    key="send"
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0, rotate: 90 }}
                    transition={spring}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleSend()}
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: 'linear-gradient(135deg, #c97754, #8a4a2e)',
                      boxShadow: '0 2px 8px rgba(201, 119, 84, 0.3)'
                    }}
                  >
                    <Send className="w-4 h-4 text-white" strokeWidth={2.5} />
                  </motion.button>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="text-center mt-2 text-[10px] font-mono tracking-wider uppercase" style={{ color: '#a8998a' }}>
              Replies are instant · Human on call at ext. 0
            </div>
          </motion.div>

          {/* Success toast for active request */}
          <AnimatePresence>
            {activeRequest && (
              <motion.div
                initial={{ y: -80, opacity: 0 }}
                animate={{ y: 52, opacity: 1 }}
                exit={{ y: -80, opacity: 0 }}
                transition={spring}
                className="absolute left-4 right-4 z-50 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg"
                style={{
                  background: '#1a1511',
                  color: '#fff8ef'
                }}
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#5c8a6f' }}>
                  <Check className="w-4 h-4" strokeWidth={3} />
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold">{activeRequest.title}</div>
                  <div className="text-[11px] opacity-70">Staff will follow up</div>
                </div>
                <button onClick={() => setActiveRequest(null)} className="opacity-60 hover:opacity-100">
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
