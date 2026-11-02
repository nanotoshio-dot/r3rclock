/* R3R Clock — timezone-aware market sessions
 * Fixes DST drift by expressing DST-sensitive exchanges in their local
 * exchange timezone instead of keeping fixed UTC offsets.
 * Also shows the four major Forex liquidity sessions separately from the
 * underlying stock exchanges so NYSE/LSE status is never confused with FX.
 * Loaded inside legacy.html by index.html.
 */
(() => {
  'use strict';

  if (typeof markets === 'undefined' || typeof calculateMarketStatus !== 'function') {
    console.warn('[R3R TZ] legacy market engine not available; patch skipped.');
    return;
  }

  const zonedMarkets = {
    wellington: {
      timeZone: 'Pacific/Auckland',
      sessions: [{ open: 11.0, close: 17.75 }]
    },
    sydney: {
      timeZone: 'Australia/Sydney',
      sessions: [{ open: 10.0, close: 16.0 }]
    },
    frankfurt: {
      timeZone: 'Europe/Berlin',
      sessions: [{ open: 9.0, close: 17.5 }],
      preOpen: { open: 8.0, close: 9.0 }
    },
    euronext: {
      timeZone: 'Europe/Paris',
      sessions: [{ open: 9.0, close: 17.5 }],
      preOpen: { open: 7.25, close: 9.0 }
    },
    six: {
      timeZone: 'Europe/Zurich',
      sessions: [{ open: 9.0, close: 17.5 }]
    },
    oslo: {
      timeZone: 'Europe/Oslo',
      sessions: [{ open: 9.0, close: 16.5 }]
    },
    london: {
      timeZone: 'Europe/London',
      sessions: [{ open: 8.0, close: 16.5 }]
    },
    newyork: {
      timeZone: 'America/New_York',
      sessions: [{ open: 9.5, close: 16.0 }]
    },
    toronto: {
      timeZone: 'America/Toronto',
      sessions: [{ open: 9.5, close: 16.0 }]
    }
  };

  // Major FX liquidity sessions. These are intentionally separate from the
  // stock-exchange cards above. They describe the conventional local Forex
  // session windows, not broker-specific instrument trading availability.
  const fxSessions = {
    sydney:  { timeZone: 'Australia/Sydney', open: 8.0, close: 17.0 },
    tokyo:   { timeZone: 'Asia/Tokyo',       open: 9.0, close: 18.0 },
    london:  { timeZone: 'Europe/London',    open: 8.0, close: 17.0 },
    newyork: { timeZone: 'America/New_York', open: 8.0, close: 17.0 }
  };

  const originalCalculateMarketStatus = calculateMarketStatus;
  const originalIsSessionCurrentlyOpen = isSessionCurrentlyOpen;

  const formatterCache = new Map();

  function formatter(timeZone) {
    if (!formatterCache.has(timeZone)) {
      formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
      }));
    }
    return formatterCache.get(timeZone);
  }

  function zonedParts(date, timeZone) {
    const out = {};
    for (const part of formatter(timeZone).formatToParts(date)) {
      if (part.type !== 'literal') out[part.type] = Number(part.value);
    }
    return out;
  }

  function dateOnlyUTC(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
  }

  function shiftLocalDate(dayDate, days) {
    return new Date(dayDate.getTime() + days * 86400000);
  }

  function decimalToHM(decimalHour) {
    let hour = Math.floor(decimalHour);
    let minute = Math.round((decimalHour - hour) * 60);
    if (minute === 60) { hour += 1; minute = 0; }
    return { hour, minute };
  }

  function getOffsetMs(date, timeZone) {
    const p = zonedParts(date, timeZone);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUTC - date.getTime() + date.getUTCMilliseconds();
  }

  function localDateTimeToInstant(dayDate, decimalHour, timeZone) {
    const y = dayDate.getUTCFullYear();
    const mo = dayDate.getUTCMonth();
    const d = dayDate.getUTCDate();
    const hm = decimalToHM(decimalHour);
    let localDay = dateOnlyUTC(y, mo + 1, d);
    if (hm.hour >= 24) {
      localDay = shiftLocalDate(localDay, Math.floor(hm.hour / 24));
      hm.hour %= 24;
    }
    const target = Date.UTC(
      localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate(),
      hm.hour, hm.minute, 0, 0
    );
    let guess = new Date(target);
    for (let i = 0; i < 3; i++) {
      const offset = getOffsetMs(guess, timeZone);
      guess = new Date(target - offset);
    }
    return guess;
  }

  function localToday(now, timeZone) {
    const p = zonedParts(now, timeZone);
    return dateOnlyUTC(p.year, p.month, p.day);
  }

  function sessionTimesZoned(dayDate, session, cfg) {
    const open = localDateTimeToInstant(dayDate, session.open, cfg.timeZone);
    let closeDay = dayDate;
    if (session.close <= session.open) closeDay = shiftLocalDate(dayDate, 1);
    const close = localDateTimeToInstant(closeDay, session.close, cfg.timeZone);
    return { open, close };
  }

  function tradingDayForLocalSession(dayDate, session, market) {
    const closeDay = session.close <= session.open ? shiftLocalDate(dayDate, 1) : dayDate;
    return isTradingDay(closeDay, market);
  }

  function candidateSessions(market, cfg, now, includeFutureDays = 0) {
    const today = localToday(now, cfg.timeZone);
    const days = [shiftLocalDate(today, -1), today];
    for (let i = 1; i <= includeFutureDays; i++) days.push(shiftLocalDate(today, i));
    const candidates = [];
    for (const day of days) {
      cfg.sessions.forEach((session, index) => {
        if (tradingDayForLocalSession(day, session, market)) {
          candidates.push({ ...sessionTimesZoned(day, session, cfg), index, day });
        }
      });
    }
    return { today, candidates };
  }

  isSessionCurrentlyOpen = function patchedIsSessionCurrentlyOpen(market, session, now) {
    const cfg = zonedMarkets[market.id];
    if (!cfg) return originalIsSessionCurrentlyOpen(market, session, now);
    const index = market.sessions.indexOf(session);
    const { candidates } = candidateSessions(market, cfg, now, 0);
    return candidates.some(c => c.index === index && now >= c.open && now < c.close);
  };

  calculateMarketStatus = function patchedCalculateMarketStatus(market, now) {
    const cfg = zonedMarkets[market.id];
    if (!cfg) return originalCalculateMarketStatus(market, now);

    const { today, candidates } = candidateSessions(market, cfg, now, 8);
    const isHolidayToday = isMarketHoliday(today, market.id);

    const openNow = candidates.find(c => now >= c.open && now < c.close);
    if (openNow) {
      return {
        isOpen: true,
        diffMs: openNow.close.getTime() - now.getTime(),
        isHolidayToday
      };
    }

    const futureOpens = candidates
      .map(c => c.open.getTime())
      .filter(t => t > now.getTime());

    return {
      isOpen: false,
      diffMs: futureOpens.length ? Math.min(...futureOpens) - now.getTime() : 0,
      isHolidayToday
    };
  };

  function utcDecimal(date) {
    return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  }

  function refreshDynamicGeometry(now = new Date()) {
    let iconsHTML = '';

    markets.forEach(market => {
      const cfg = zonedMarkets[market.id];
      const today = cfg ? localToday(now, cfg.timeZone) : null;

      market.sessions.forEach((session, sIdx) => {
        let openHour = session.open;
        let closeHour = session.close;

        if (cfg && cfg.sessions[sIdx]) {
          const times = sessionTimesZoned(today, cfg.sessions[sIdx], cfg);
          openHour = utcDecimal(times.open);
          closeHour = utcDecimal(times.close);
          if (times.close.getUTCDate() !== times.open.getUTCDate() || closeHour <= openHour) closeHour += 24;

          const arc = document.getElementById(`arc-${market.id}-${sIdx}`);
          if (arc) arc.setAttribute('d', describeArc(cx, cy, market.radius, openHour * 15, closeHour * 15));
          if (sIdx === 0) {
            const textPath = document.getElementById(`tpath-${market.id}`);
            if (textPath) textPath.setAttribute('d', describeTextPath(cx, cy, market.radius, openHour * 15, closeHour * 15));
          }
        } else if (closeHour <= openHour) {
          closeHour += 24;
        }

        iconsHTML += sunIcon(polarToCartesian(cx, cy, market.radius, openHour * 15));
        iconsHTML += sunIcon(polarToCartesian(cx, cy, market.radius, closeHour * 15), 'dim');
      });
    });

    const iconsGroup = document.getElementById('iconsGroup');
    if (iconsGroup) iconsGroup.innerHTML = iconsHTML;
  }

  function fxSessionIsOpen(now, cfg) {
    const today = localToday(now, cfg.timeZone);
    const dow = today.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const open = localDateTimeToInstant(today, cfg.open, cfg.timeZone);
    const close = localDateTimeToInstant(today, cfg.close, cfg.timeZone);
    return now >= open && now < close;
  }

  function fxWords() {
    const lang = (typeof currentLang !== 'undefined' && currentLang) ? currentLang : 'pt';
    const words = {
      pt: { open: 'FX ABERTO', closed: 'FX FECHADO' },
      es: { open: 'FX ABIERTO', closed: 'FX CERRADO' },
      en: { open: 'FX OPEN', closed: 'FX CLOSED' },
      fr: { open: 'FX OUVERT', closed: 'FX FERMÉ' }
    };
    return words[lang] || words.pt;
  }

  function ensureFxBadgeStyles() {
    if (document.getElementById('r3r-fx-session-styles')) return;
    const style = document.createElement('style');
    style.id = 'r3r-fx-session-styles';
    style.textContent = `
      .r3r-fx-session-badge{display:inline-flex;align-items:center;margin-left:4px;padding:1px 5px;border-radius:999px;border:1px solid var(--panel-border);font-size:8px;font-weight:800;letter-spacing:.035em;line-height:1.4;white-space:nowrap;vertical-align:middle}
      .r3r-fx-session-badge.fx-open{color:#67e88f;border-color:color-mix(in srgb,#67e88f 45%,var(--panel-border));background:color-mix(in srgb,#1c6639 18%,var(--panel-bg))}
      .r3r-fx-session-badge.fx-closed{color:var(--text-dim);border-color:color-mix(in srgb,var(--text-dim) 24%,var(--panel-border));background:color-mix(in srgb,var(--text-dim) 7%,var(--panel-bg))}
    `;
    document.head.appendChild(style);
  }

  function ensureFxSessionBadges() {
    ensureFxBadgeStyles();
    Object.keys(fxSessions).forEach(marketId => {
      if (document.getElementById(`fx-session-${marketId}`)) return;
      const titleGroup = document.querySelector(`#card-${marketId} .market-title-group`);
      if (!titleGroup) return;
      const badge = document.createElement('span');
      badge.id = `fx-session-${marketId}`;
      badge.className = 'r3r-fx-session-badge fx-closed';
      titleGroup.appendChild(badge);
    });
  }

  function refreshFxSessionBadges(now = new Date()) {
    ensureFxSessionBadges();
    const words = fxWords();
    Object.entries(fxSessions).forEach(([marketId, cfg]) => {
      const badge = document.getElementById(`fx-session-${marketId}`);
      if (!badge) return;
      const open = fxSessionIsOpen(now, cfg);
      badge.classList.toggle('fx-open', open);
      badge.classList.toggle('fx-closed', !open);
      badge.textContent = open ? words.open : words.closed;
      badge.title = `Forex session — ${cfg.timeZone}`;
    });
  }

  refreshDynamicGeometry();
  refreshFxSessionBadges();
  setInterval(refreshDynamicGeometry, 60000);
  setInterval(refreshFxSessionBadges, 1000);

  // Regression markers for the US DST switch on 2026-11-01.
  // At 14:22Z on 2026-11-02 it is 09:22 EST: NY Forex is already open,
  // while NYSE is still closed until 09:30 EST.
  const splitRegressionInstant = new Date('2026-11-02T14:22:00Z');
  const ny = markets.find(m => m.id === 'newyork');
  if (ny) {
    const nyseRegression = calculateMarketStatus(ny, splitRegressionInstant);
    const nyFxRegression = fxSessionIsOpen(splitRegressionInstant, fxSessions.newyork);
    console.info('[R3R TZ] loaded; 2026-11-02 14:22Z NYSE open =', nyseRegression.isOpen, '| NY FX open =', nyFxRegression);
  }
})();
