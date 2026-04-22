import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
  Bell, Search, Plus, Clock, ArrowUpRight, ChevronRight,
  BookOpen, Users, BedDouble, Sun, Moon, Sunrise,
  ArrowRight, MoreHorizontal, Filter, Star,
  CircleDot, AlertCircle, CheckCircle2
} from 'lucide-react';

export default function ThroughLineApp() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeTab, setActiveTab] = useState('today');
  const [activeShift, setActiveShift] = useState('pm');
  const [hoveredRow, setHoveredRow] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Real keyboard shortcuts: 1/2/3 for shifts, Esc to blur
  useEffect(() => {
    const handleKey = (e) => {
      // Ignore if user is typing
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '1') setActiveShift('am');
      if (e.key === '2') setActiveShift('pm');
      if (e.key === '3') setActiveShift('overnight');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const greeting = useMemo(() => {
    const h = currentTime.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, [currentTime]);

  const spring = { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 };
  const softSpring = { type: 'spring', stiffness: 260, damping: 28, mass: 1 };

  // Refs for scroll-to on stat click
  const arrivalsRef = React.useRef(null);
  const shiftRef = React.useRef(null);
  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const shiftData = {
    am: {
      label: 'AM Shift',
      hours: '07:00 — 15:00',
      icon: Sunrise,
      agent: 'Marcus Chen',
      status: 'completed',
      statusTime: 'Closed 14:58',
      itemCount: 6,
      summary: 'Steady morning with two VIP check-outs handled smoothly. One maintenance blocker on 308 — HVAC tech came but room is still warm, moved guest to 312. Cornerstone Law group started arriving at 13:30, 12 of 18 in by end of shift.',
      items: [
        { icon: AlertCircle, tone: 'urgent', title: '308 · HVAC not resolved', body: 'Tech came at 11am. Room still warm. Moved guest to 312. Do NOT sell 308 until revisit.', tag: 'Blocker', time: '11:42' },
        { icon: Star, tone: 'vip', title: '412 · Mrs. Castellanos arrives 16:30', body: 'Ambassador · 4th stay. Feather allergy — pillows already swapped. Prefers west side.', tag: 'VIP', time: '09:15' },
        { icon: CircleDot, tone: 'info', title: 'Cornerstone Law group', body: '12 of 18 checked in. Remaining arrive after 18:00. Welcome amenities placed in all rooms.', tag: 'Group', time: '13:30' },
        { icon: CheckCircle2, tone: 'done', title: 'Safe deposit box 14 cleared', body: 'Mr. Vance returned contents at 10am. Box reset.', tag: 'Done', time: '10:00' },
        { icon: CircleDot, tone: 'info', title: 'Delivery held for 702', body: 'FedEx overnight — Mr. Kim. Held at bell, guest notified via SMS.', tag: 'Bell', time: '12:18' },
        { icon: CircleDot, tone: 'info', title: 'Lost & found · Rm 509', body: 'Silver watch found under bed. Tagged, locked in L&F. Guest (Ramirez) contacted.', tag: 'L&F', time: '11:05' },
      ]
    },
    pm: {
      label: 'PM Shift',
      hours: '15:00 — 23:00',
      icon: Sun,
      agent: 'Jesse Szemkus',
      status: 'active',
      statusTime: 'In progress',
      itemCount: 3,
      summary: 'On desk now. 19 arrivals still pending, averaging 3.2 min per check-in. Mrs. Castellanos handled. 308 still blocked pending engineering revisit in the morning. No escalations so far.',
      items: [
        { icon: Star, tone: 'vip', title: '412 · Mrs. Castellanos checked in', body: 'West-side room confirmed. Pillow swap verified. She mentioned enjoying the rooftop last stay.', tag: 'VIP', time: '16:34' },
        { icon: AlertCircle, tone: 'urgent', title: '224 · Housekeeping delay', body: 'Guest Jonah Reyes arrived early. Room not ready. Offered lobby cocktail while wait — est 8 min.', tag: 'Active', time: '16:07' },
        { icon: CircleDot, tone: 'info', title: 'Cornerstone Law · 6 remaining', body: 'Keys cut for all 6. Amenities placed. Expected 18:00–19:30.', tag: 'Group', time: '15:45' },
      ]
    },
    overnight: {
      label: 'Overnight',
      hours: '23:00 — 07:00',
      icon: Moon,
      agent: 'Kai Whitfield · on call',
      status: 'pending',
      statusTime: 'Begins 23:00',
      itemCount: 4,
      carryingForward: true,
      summary: 'Night audit in prep. These items will carry from PM to overnight at shift close — review and confirm before handing off at 22:45.',
      items: [
        { icon: AlertCircle, tone: 'urgent', title: '308 · HVAC revisit at 07:30', body: 'Engineering scheduled first thing. Do not reassign until cleared.', tag: 'Carry-over', time: '07:30' },
        { icon: CircleDot, tone: 'info', title: 'Cornerstone wake-up calls · 06:30', body: '18 rooms · automated, but verify list before 23:30 audit run.', tag: 'Scheduled', time: '06:30' },
        { icon: CircleDot, tone: 'info', title: 'Late arrivals expected · after 23:00', body: '3 reservations flagged in Opera — keys pre-cut, amenities placed.', tag: 'Pending', time: '23:15' },
        { icon: CircleDot, tone: 'info', title: 'F&B folio close · 02:00', body: 'Skybar closes at midnight, final folio post by 2am per audit checklist.', tag: 'Routine', time: '02:00' },
      ]
    }
  };

  const currentShift = shiftData[activeShift];

  return (
    <div className="min-h-screen antialiased" style={{
      background: '#faf8f4',
      color: '#1a1a1c',
      fontFamily: "'General Sans', -apple-system, sans-serif"
    }}>
      <style>{`
        @import url('https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

        body, * {
          font-family: 'General Sans', -apple-system, 'Segoe UI', sans-serif;
        }
        .font-display {
          font-family: 'General Sans', -apple-system, sans-serif;
          font-weight: 600;
          letter-spacing: -0.025em;
        }
        .font-display-tight {
          font-family: 'General Sans', -apple-system, sans-serif;
          font-weight: 600;
          letter-spacing: -0.035em;
        }
        .font-mono { font-family: 'JetBrains Mono', monospace; }

        .card {
          background: #ffffff;
          border: 1px solid #e5e3de;
          box-shadow: 0 1px 2px rgba(10, 10, 11, 0.02);
        }
        .card-sunk {
          background: #f1ede6;
          border: 1px solid #e5e3de;
        }
        .btn-ghost { transition: background 0.2s ease; }
        .btn-ghost:hover { background: rgba(10, 10, 11, 0.05); }

        .sla-ring { transform: rotate(-90deg); }

        .divider-dotted {
          background-image: linear-gradient(90deg, rgba(10,10,11,0.18) 50%, transparent 50%);
          background-size: 6px 1px; background-repeat: repeat-x; background-position: center; height: 1px;
        }

        @keyframes ambient-pulse {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
        .ambient-pulse { animation: ambient-pulse 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite; }

        .sheen { position: relative; overflow: hidden; }
        .sheen::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%);
          transform: translateX(-100%);
          transition: transform 0.8s cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        }
        .sheen:hover::after { transform: translateX(100%); }
      `}</style>

      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={softSpring}
        className="sticky top-0 z-40 backdrop-blur-xl"
        style={{ background: 'rgba(250, 248, 244, 0.88)', borderBottom: '1px solid #e5e3de' }}
      >
        <div className="max-w-[1440px] mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <motion.div className="flex items-center gap-3" whileHover={{ scale: 1.02 }} transition={spring}>
              <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: '#0a0a0b' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
              <div className="leading-none">
                <div className="font-display text-[18px] tracking-tight">ThroughLine</div>
                <div className="text-[10px] tracking-[0.18em] uppercase mt-1" style={{ color: '#6b6b70', fontWeight: 500 }}>Grand Bohemian · Charlotte</div>
              </div>
            </motion.div>

            <LayoutGroup>
              <nav className="flex items-center gap-1 text-sm relative">
                {[
                  { k: 'today', label: 'Today' },
                  { k: 'arrivals', label: 'Arrivals' },
                  { k: 'rooms', label: 'Rooms' },
                  { k: 'handover', label: 'Handover' },
                  { k: 'guests', label: 'Guests' },
                ].map(t => (
                  <button
                    key={t.k}
                    onClick={() => setActiveTab(t.k)}
                    className="px-3.5 py-1.5 rounded-md relative font-medium"
                    style={{ color: activeTab === t.k ? '#faf8f4' : '#1a1a1c' }}
                  >
                    {activeTab === t.k && (
                      <motion.div
                        layoutId="nav-indicator"
                        className="absolute inset-0 rounded-md"
                        style={{ background: '#0a0a0b' }}
                        transition={spring}
                      />
                    )}
                    <span className="relative z-10">{t.label}</span>
                  </button>
                ))}
              </nav>
            </LayoutGroup>
          </div>

          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              transition={spring}
              className="flex items-center gap-2 px-3 h-9 rounded-md text-sm btn-ghost"
              style={{ color: '#6b6b70' }}
            >
              <Search className="w-4 h-4" />
              <span>Search guests, rooms, notes</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              transition={spring}
              className="w-9 h-9 rounded-md btn-ghost flex items-center justify-center relative"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-2 right-2 w-1 h-1 rounded-full ambient-pulse" style={{ background: '#0a0a0b' }} />
            </motion.button>
            <div className="w-px h-6 mx-1" style={{ background: '#e5e3de' }} />
            <div className="flex items-center gap-2.5 pr-1">
              <motion.div
                whileHover={{ scale: 1.08 }}
                transition={spring}
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border cursor-pointer"
                style={{ background: '#faf8f4', color: '#0a0a0b', borderColor: '#0a0a0b' }}
              >
                JS
              </motion.div>
              <div className="leading-tight">
                <div className="text-xs font-semibold">Jesse S.</div>
                <div className="text-[10px]" style={{ color: '#6b6b70' }}>PM Shift · Front Desk</div>
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      <main className="max-w-[1440px] mx-auto px-8 py-10">
        {/* Welcome */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } }
          }}
          className="mb-10 flex items-end justify-between"
        >
          <motion.div variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: softSpring } }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-2 text-[11px] font-mono tracking-wider" style={{ color: '#6b6b70' }}>
                <span className="w-1 h-1 rounded-full ambient-pulse" style={{ background: '#0a0a0b' }} />
                {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
                <span>·</span>
                {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </div>
            </div>
            <h1 className="font-display-tight text-[56px] leading-[0.95]" style={{ color: '#0a0a0b' }}>
              {greeting}, Jesse.
            </h1>
            <p className="mt-4 text-[15px] max-w-xl leading-relaxed" style={{ color: '#6b6b70' }}>
              You're on the PM desk. The AM shift closed clean — one blocker to watch and a repeat VIP in at 16:30.
            </p>
          </motion.div>

          <motion.div
            variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: softSpring } }}
            className="flex items-center gap-2"
          >
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={spring}
              className="h-10 px-4 rounded-md text-sm font-medium btn-ghost flex items-center gap-2 border"
              style={{ borderColor: '#e5e3de' }}
            >
              <BookOpen className="w-4 h-4" /> Handover log
            </motion.button>
            <motion.button
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={spring}
              className="h-10 px-4 rounded-md text-sm font-semibold sheen flex items-center gap-2"
              style={{ background: '#0a0a0b', color: '#faf8f4' }}
            >
              <Plus className="w-4 h-4" /> New note
            </motion.button>
          </motion.div>
        </motion.div>

        {/* Department header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...softSpring, delay: 0.25 }}
          className="mb-6 flex items-end justify-between"
        >
          <div>
            <div className="text-[10px] font-mono tracking-[0.2em] uppercase mb-1.5" style={{ color: '#6b6b70' }}>Department</div>
            <h2 className="font-display-tight text-[32px] leading-none">Front Desk</h2>
          </div>
          <div className="text-[11px] font-mono flex items-center gap-4" style={{ color: '#6b6b70' }}>
            <span>3 shifts · 1 active</span>
            <span>·</span>
            <span>9 items carried forward</span>
          </div>
        </motion.div>

        {/* SHIFT PASS-ON */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...softSpring, delay: 0.3 }}
          className="mb-10 card rounded-xl overflow-hidden"
        >
          {/* Tabs */}
          <LayoutGroup>
            <div className="flex items-stretch border-b relative" style={{ borderColor: '#e5e3de' }}>
              {Object.entries(shiftData).map(([key, shift], idx) => {
                const Icon = shift.icon;
                const isActive = activeShift === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveShift(key)}
                    className="flex-1 px-6 py-5 text-left relative group"
                    style={{
                      borderRight: idx < 2 ? '1px solid #e5e3de' : 'none',
                      color: isActive ? '#faf8f4' : '#1a1a1c'
                    }}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="shift-indicator"
                        className="absolute inset-0"
                        style={{ background: '#0a0a0b' }}
                        transition={{ ...softSpring, stiffness: 320 }}
                      />
                    )}
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <motion.div
                            animate={isActive ? { rotate: [0, -8, 0] } : {}}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                          >
                            <Icon className="w-4 h-4" style={{ opacity: isActive ? 0.9 : 0.5 }} strokeWidth={1.75} />
                          </motion.div>
                          <span className="font-display text-[20px]">{shift.label}</span>
                          <kbd className="ml-1 px-1.5 py-0.5 text-[9px] rounded font-mono border" style={{
                            borderColor: isActive ? 'rgba(242,239,232,0.25)' : '#e5e3de',
                            color: isActive ? 'rgba(242,239,232,0.5)' : '#a8a8ac'
                          }}>
                            {idx + 1}
                          </kbd>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {shift.status === 'active' && (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full ambient-pulse" style={{ background: isActive ? '#faf8f4' : '#0a0a0b' }} />
                              <span className="text-[10px] font-mono tracking-wider uppercase" style={{ opacity: isActive ? 0.9 : 0.6 }}>Live</span>
                            </>
                          )}
                          {shift.status === 'completed' && (
                            <span className="text-[10px] font-mono tracking-wider uppercase" style={{ opacity: isActive ? 0.7 : 0.5 }}>Closed</span>
                          )}
                          {shift.status === 'pending' && (
                            <span className="text-[10px] font-mono tracking-wider uppercase" style={{ opacity: isActive ? 0.6 : 0.4 }}>Pending</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-mono" style={{ opacity: isActive ? 0.7 : 0.55 }}>
                          {shift.hours} · {shift.agent}
                        </div>
                        <div className="text-[11px] font-mono" style={{ opacity: isActive ? 0.7 : 0.55 }}>
                          {shift.itemCount} {shift.itemCount === 1 ? 'item' : 'items'}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>

          {/* Animated tab content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeShift}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ ...softSpring, duration: 0.35 }}
            >
              {/* Summary strip */}
              <div className="px-8 py-6 border-b" style={{ borderColor: '#e5e3de', background: '#faf8f4' }}>
                <div className="flex items-start gap-6">
                  <div className="flex-shrink-0">
                    <div className="text-[10px] font-mono tracking-[0.2em] uppercase mb-1" style={{ color: '#6b6b70' }}>Summary</div>
                    <div className="text-[11px] font-mono" style={{ color: '#a8a8ac' }}>{currentShift.statusTime}</div>
                  </div>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15 }}
                    className="flex-1 text-[15px] leading-relaxed"
                    style={{ color: '#1a1a1c', fontWeight: 500 }}
                  >
                    {currentShift.summary}
                  </motion.p>
                </div>
              </div>

              {/* Carry-forward banner (overnight preview) */}
              {currentShift.carryingForward && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={softSpring}
                  className="px-8 py-3 flex items-center justify-between border-b"
                  style={{ background: '#0a0a0b', color: '#faf8f4', borderColor: '#0a0a0b' }}
                >
                  <div className="flex items-center gap-3">
                    <Moon className="w-4 h-4 opacity-70" strokeWidth={1.5} />
                    <div className="text-[12px] font-medium">
                      Preview · these items will carry from PM at shift close
                    </div>
                  </div>
                  <div className="text-[10px] font-mono tracking-wider uppercase opacity-60">
                    Auto-pinned
                  </div>
                </motion.div>
              )}

              {/* Items */}
              {currentShift.items.length > 0 ? (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: {},
                    visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } }
                  }}
                  className="divide-y"
                  style={{ borderColor: '#e5e3de' }}
                >
                  {currentShift.items.map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <motion.div
                        key={`${activeShift}-${i}`}
                        variants={{
                          hidden: { opacity: 0, y: 8 },
                          visible: { opacity: 1, y: 0, transition: spring }
                        }}
                        onHoverStart={() => setHoveredRow(`${activeShift}-${i}`)}
                        onHoverEnd={() => setHoveredRow(null)}
                        className="px-8 py-4 flex items-start gap-5 group cursor-pointer relative"
                      >
                        <motion.div
                          className="absolute inset-0 pointer-events-none"
                          animate={{
                            backgroundColor: hoveredRow === `${activeShift}-${i}` ? 'rgba(250, 248, 244, 1)' : 'rgba(250, 248, 244, 0)'
                          }}
                          transition={{ duration: 0.2 }}
                        />

                        <div className="w-12 pt-0.5 relative">
                          <div className="font-mono text-[12px] font-semibold">{item.time}</div>
                        </div>

                        <motion.div
                          whileHover={{ scale: 1.06, rotate: item.tone === 'urgent' ? -3 : 3 }}
                          transition={spring}
                          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border relative"
                          style={{
                            background: item.tone === 'urgent' ? '#0a0a0b' :
                                        item.tone === 'vip' ? '#f1ede6' :
                                        item.tone === 'done' ? '#faf8f4' : '#ffffff',
                            color: item.tone === 'urgent' ? '#faf8f4' :
                                   item.tone === 'done' ? '#a8a8ac' : '#1a1a1c',
                            borderColor: item.tone === 'urgent' ? '#0a0a0b' : '#e5e3de'
                          }}
                        >
                          <Icon className="w-4 h-4" strokeWidth={1.75} />
                        </motion.div>

                        <div className="flex-1 min-w-0 pt-0.5 relative">
                          <div className="flex items-center justify-between gap-3 mb-1">
                            <h4 className="font-display text-[16px] leading-tight" style={{
                              textDecoration: item.tone === 'done' ? 'line-through' : 'none',
                              opacity: item.tone === 'done' ? 0.5 : 1
                            }}>{item.title}</h4>
                            <span className="text-[10px] font-mono tracking-wider uppercase px-2 py-0.5 rounded-sm flex-shrink-0" style={{
                              background: item.tone === 'urgent' ? '#0a0a0b' :
                                          item.tone === 'vip' ? '#1a1a1c' : '#f1ede6',
                              color: item.tone === 'urgent' || item.tone === 'vip' ? '#faf8f4' : '#6b6b70'
                            }}>
                              {item.tag}
                            </span>
                          </div>
                          <p className="text-[13px] leading-relaxed" style={{
                            color: '#6b6b70',
                            opacity: item.tone === 'done' ? 0.6 : 1
                          }}>{item.body}</p>
                        </div>

                        <motion.button
                          animate={{
                            opacity: hoveredRow === `${activeShift}-${i}` ? 1 : 0,
                            x: hoveredRow === `${activeShift}-${i}` ? 0 : -4
                          }}
                          transition={spring}
                          className="w-7 h-7 rounded-md flex items-center justify-center relative"
                          style={{ background: '#0a0a0b', color: '#faf8f4' }}
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </motion.button>
                      </motion.div>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={softSpring}
                  className="px-8 py-20 text-center"
                >
                  <motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Moon className="w-10 h-10 mx-auto mb-4" style={{ color: '#a8a8ac' }} strokeWidth={1.2} />
                  </motion.div>
                  <p className="font-display text-[24px] mb-2">Overnight not yet started</p>
                  <p className="text-[13px]" style={{ color: '#6b6b70' }}>Items will appear here once the night audit begins at 23:00.</p>
                </motion.div>
              )}

              {currentShift.items.length > 0 && (
                <div className="px-8 py-4 flex items-center justify-between" style={{ background: '#faf8f4', borderTop: '1px solid #e5e3de' }}>
                  <div className="text-[11px] font-mono" style={{ color: '#6b6b70' }}>
                    {activeShift === 'pm' && 'Add items from your current shift — they\'ll carry to overnight'}
                    {activeShift === 'am' && `Closed by ${currentShift.agent} at ${currentShift.statusTime.replace('Closed ', '')}`}
                    {activeShift === 'overnight' && 'Review before handing off to Kai at 22:45'}
                  </div>
                  <div className="flex items-center gap-2">
                    {activeShift === 'pm' && (
                      <>
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          transition={spring}
                          className="h-8 px-3 rounded-md text-[12px] font-medium btn-ghost border"
                          style={{ borderColor: '#e5e3de' }}
                        >
                          Compose full handover
                        </motion.button>
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          transition={spring}
                          className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5 sheen"
                          style={{ background: '#0a0a0b', color: '#faf8f4' }}
                        >
                          <Plus className="w-3 h-3" /> Add item
                        </motion.button>
                      </>
                    )}
                    {activeShift === 'am' && (
                      <motion.button
                        whileHover={{ x: 2 }}
                        transition={spring}
                        className="h-8 px-3 rounded-md text-[12px] font-medium btn-ghost flex items-center gap-1.5"
                      >
                        View full {currentShift.label.toLowerCase()} log <ArrowRight className="w-3 h-3" />
                      </motion.button>
                    )}
                    {activeShift === 'overnight' && (
                      <>
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          transition={spring}
                          className="h-8 px-3 rounded-md text-[12px] font-medium btn-ghost border"
                          style={{ borderColor: '#e5e3de' }}
                        >
                          Edit carry-forward
                        </motion.button>
                        <motion.button
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          transition={spring}
                          className="h-8 px-3 rounded-md text-[12px] font-semibold flex items-center gap-1.5 sheen"
                          style={{ background: '#0a0a0b', color: '#faf8f4' }}
                        >
                          <CheckCircle2 className="w-3 h-3" /> Confirm & hand off
                        </motion.button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.section>

        {/* Stat strip */}
        <motion.section
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.08, delayChildren: 0.5 } }
          }}
          className="grid grid-cols-4 gap-0 mb-10 card rounded-xl overflow-hidden"
        >
          {[
            { label: 'Arrivals today', value: '47', delta: '+3', sub: '28 checked in · 19 pending', icon: Users, action: () => scrollToSection(arrivalsRef), hint: 'View arrivals' },
            { label: 'Departures', value: '52', delta: '41 done', sub: '11 still to check out', icon: ArrowUpRight, action: null, hint: null },
            { label: 'Occupancy', value: '91%', delta: '+4pt', sub: '137 of 150 sold', icon: BedDouble, action: null, hint: null },
            { label: 'SLA on time', value: '96%', delta: 'healthy', sub: '1 ticket aging · 38m', icon: Clock, action: () => scrollToSection(arrivalsRef), hint: 'Find the aging ticket' },
          ].map((s, i) => (
            <motion.button
              key={i}
              variants={{
                hidden: { opacity: 0, y: 12 },
                visible: { opacity: 1, y: 0, transition: softSpring }
              }}
              whileHover={{ backgroundColor: '#faf8f4' }}
              transition={{ duration: 0.2 }}
              onClick={s.action || undefined}
              className={`p-6 relative text-left ${s.action ? 'cursor-pointer' : 'cursor-default'}`}
              style={{ borderRight: i < 3 ? '1px solid #e5e3de' : 'none' }}
            >
              <div className="flex items-start justify-between mb-6">
                <s.icon className="w-4 h-4" style={{ color: '#6b6b70' }} strokeWidth={1.5} />
                <span className="text-[10px] font-mono tracking-wider" style={{ color: '#6b6b70' }}>{s.delta}</span>
              </div>
              <div className="font-display-tight text-[48px] leading-none" style={{ color: '#0a0a0b' }}>
                {s.value}
              </div>
              <div className="mt-3 text-[13px] font-semibold">{s.label}</div>
              <div className="text-[11px] mt-0.5" style={{ color: '#6b6b70' }}>{s.sub}</div>
              {s.hint && (
                <div className="mt-3 text-[10px] font-mono tracking-wider uppercase flex items-center gap-1" style={{ color: '#0a0a0b' }}>
                  {s.hint} <ArrowRight className="w-3 h-3" />
                </div>
              )}
            </motion.button>
          ))}
        </motion.section>

        {/* Main grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* Arrivals */}
          <motion.section
            ref={arrivalsRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...softSpring, delay: 0.7 }}
            className="col-span-8 card rounded-xl overflow-hidden scroll-mt-20"
          >
            <div className="px-6 py-5 flex items-center justify-between border-b" style={{ borderColor: '#e5e3de' }}>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-display text-[22px]">Arrivals board</h3>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm flex items-center gap-1" style={{ background: '#0a0a0b', color: '#faf8f4' }}>
                    <span className="w-1 h-1 rounded-full ambient-pulse bg-white" />
                    LIVE
                  </span>
                </div>
                <p className="text-[12px]" style={{ color: '#6b6b70' }}>Next 6 hours · auto-refreshes from Opera</p>
              </div>
              <div className="flex items-center gap-1.5">
                <motion.button
                  whileHover={{ y: -1 }}
                  transition={spring}
                  className="h-8 px-3 rounded-md text-xs btn-ghost flex items-center gap-1.5 border font-medium"
                  style={{ borderColor: '#e5e3de' }}
                >
                  <Filter className="w-3.5 h-3.5" /> All guests
                </motion.button>
                <motion.button
                  whileHover={{ rotate: 90 }}
                  transition={spring}
                  className="h-8 w-8 rounded-md btn-ghost flex items-center justify-center border"
                  style={{ borderColor: '#e5e3de' }}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </motion.button>
              </div>
            </div>

            <motion.div
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.05, delayChildren: 0.8 } }
              }}
              className="divide-y"
              style={{ borderColor: '#e5e3de' }}
            >
              {[
                { time: '15:30', name: 'Mrs. Eleanor Castellanos', room: '412', status: 'ready', tags: ['Ambassador', 'Returning · 4th stay'], note: 'Feather-free pillows swapped · west-side room confirmed', sla: 92 },
                { time: '16:00', name: 'Dr. Theodore Finch & party', room: '508 · Suite', status: 'ready', tags: ['Gold', 'Anniversary'], note: 'Champagne + note from GM in room · signed card', sla: 100 },
                { time: '16:15', name: 'Jonah Reyes', room: '224', status: 'inspecting', tags: ['First stay'], note: 'Housekeeping finishing · 8 min to ready', sla: 60 },
                { time: '16:45', name: 'Cornerstone Law (3 of 6 rem.)', room: '301, 303, 305', status: 'blocked', tags: ['Group · CORN24'], note: 'Welcome amenities placed · keys cut', sla: 88 },
                { time: '17:20', name: 'Ms. Priya Anand', room: '617', status: 'ready', tags: ['Platinum'], note: 'Quiet floor requested · accommodated', sla: 100 },
              ].map((a, i) => (
                <motion.div
                  key={i}
                  variants={{
                    hidden: { opacity: 0, x: -8 },
                    visible: { opacity: 1, x: 0, transition: softSpring }
                  }}
                  whileHover={{ backgroundColor: '#faf8f4', x: 2 }}
                  transition={{ duration: 0.2 }}
                  className="px-6 py-4 flex items-center gap-5 group cursor-pointer"
                >
                  <div className="font-mono text-sm font-semibold w-14" style={{ color: '#1a1a1c' }}>{a.time}</div>

                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="relative">
                      <svg className="w-11 h-11 sla-ring">
                        <circle cx="22" cy="22" r="18" fill="none" stroke="#e5e3de" strokeWidth="2" />
                        <motion.circle
                          cx="22" cy="22" r="18" fill="none"
                          stroke={a.sla >= 90 ? '#0a0a0b' : a.sla >= 70 ? '#2e2e31' : '#6b6b70'}
                          strokeWidth="2" strokeLinecap="round"
                          initial={{ strokeDasharray: '0 113' }}
                          animate={{ strokeDasharray: `${(a.sla/100) * 113} 113` }}
                          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1], delay: 0.9 + i * 0.1 }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono font-semibold">
                        {a.sla}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-display text-[15px] truncate">{a.name}</span>
                        {a.tags.map(t => (
                          <span key={t} className="text-[10px] font-mono tracking-wide px-1.5 py-0.5 rounded-sm" style={{
                            background: t.includes('Ambassador') || t.includes('Platinum') ? '#0a0a0b' :
                                        t.includes('Gold') ? '#1a1a1c' : '#f1ede6',
                            color: t.includes('Ambassador') || t.includes('Platinum') || t.includes('Gold') ? '#faf8f4' : '#6b6b70'
                          }}>
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="text-[12px] truncate" style={{ color: '#6b6b70' }}>{a.note}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="font-display-tight text-[20px]">{a.room}</div>
                      <div className="text-[10px] font-mono tracking-wider uppercase" style={{ color: '#6b6b70' }}>
                        {a.status}
                      </div>
                    </div>

                    <motion.button
                      whileHover={{ backgroundColor: '#0a0a0b', color: '#faf8f4' }}
                      transition={{ duration: 0.15 }}
                      className="w-8 h-8 rounded-md flex items-center justify-center"
                      style={{ background: '#f1ede6' }}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <div className="px-6 py-3 flex items-center justify-between" style={{ background: '#faf8f4', borderTop: '1px solid #e5e3de' }}>
              <div className="text-[11px] font-mono" style={{ color: '#6b6b70' }}>Showing 5 of 19 pending</div>
              <motion.button
                whileHover={{ x: 2 }}
                transition={spring}
                className="text-[12px] font-medium flex items-center gap-1"
              >
                View full arrivals list <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            </div>
          </motion.section>

          {/* Right column */}
          <motion.aside
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...softSpring, delay: 0.8 }}
            className="col-span-4 space-y-6"
          >
            {/* At the desk */}
            <div className="card rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display text-[18px]">At the desk now</h3>
                <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: '#6b6b70' }}>
                  <span className="w-1 h-1 rounded-full ambient-pulse" style={{ background: '#0a0a0b' }} />
                  LIVE
                </span>
              </div>

              <motion.div
                initial={{ scale: 0.98, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...softSpring, delay: 1 }}
                className="card-sunk rounded-md p-4 border-l-2"
                style={{ borderLeftColor: '#0a0a0b' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-mono tracking-wider uppercase" style={{ color: '#6b6b70' }}>Checking in</span>
                  <span className="text-[11px] font-mono">00:02:14</span>
                </div>
                <div className="font-display text-[20px] leading-tight mb-1">Mr. Henderson</div>
                <div className="text-[12px]" style={{ color: '#6b6b70' }}>Reservation 88142 · Queen King · 2 nights</div>
                <div className="mt-3 flex gap-1.5">
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    transition={spring}
                    className="flex-1 h-8 text-[12px] font-semibold rounded-md sheen"
                    style={{ background: '#0a0a0b', color: '#faf8f4' }}
                  >
                    Complete check-in
                  </motion.button>
                  <motion.button
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    transition={spring}
                    className="h-8 px-3 text-[12px] rounded-md btn-ghost border font-medium"
                    style={{ borderColor: '#e5e3de' }}
                  >
                    Notes
                  </motion.button>
                </div>
              </motion.div>

              <div className="mt-4 flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2" style={{ color: '#6b6b70' }}>
                  <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>3 people in lobby · 1 queuing</span>
                </div>
                <motion.button
                  whileHover={{ x: 2 }}
                  transition={spring}
                  className="font-medium"
                >
                  Queue →
                </motion.button>
              </div>
            </div>

            {/* Team chatter */}
            <div className="card rounded-xl p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-display text-[18px]">Team chatter</h3>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={spring}
                  className="text-[10px] font-mono flex items-center gap-1"
                  style={{ color: '#6b6b70' }}
                >
                  <Plus className="w-3 h-3" /> POST
                </motion.button>
              </div>
              <p className="text-[11px] mb-4" style={{ color: '#a8a8ac' }}>Real-time cross-department radio · not pass-on log</p>

              <div className="space-y-3">
                {[
                  { author: 'Sofia · Housekeeping', time: '14m', text: 'Linen cart on 4 needs refill. Flagged to supervisor.' },
                  { author: 'Dre · Bell', time: '31m', text: 'Mr. Kim (suite 702) asked about Friday dinner at 5Church — 7pm for 4.' },
                  { author: 'Engineering · Ty', time: '42m', text: 'Heading up to 308 now with thermostat replacement. ETA 20 min.' },
                  { author: 'Valet · Jen', time: '1h', text: 'Garage level 2 almost full. Overflow cones set up for level 3.' },
                ].map((n, i, arr) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...softSpring, delay: 1.1 + i * 0.08 }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold">{n.author}</span>
                      <span className="text-[10px] font-mono" style={{ color: '#a8a8ac' }}>{n.time}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: '#6b6b70' }}>{n.text}</p>
                    {i < arr.length - 1 && <div className="divider-dotted mt-3" />}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.aside>
        </div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 0.6 }}
          className="mt-16 pt-6 flex items-center justify-between text-[11px] font-mono"
          style={{ borderTop: '1px dashed #d4d1c9', color: '#6b6b70' }}
        >
          <div>THROUGHLINE · V4.0 · PM SHIFT · {currentTime.toLocaleDateString()}</div>
          <div className="flex items-center gap-4">
            <span>Opera PMS · connected</span>
            <span>·</span>
            <span>Bonvoy sync · 2m ago</span>
            <span>·</span>
            <span>Maintenance queue · 4 open</span>
          </div>
        </motion.footer>
      </main>
    </div>
  );
}
