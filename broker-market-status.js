/* R3R Clock — broker/instrument status layer
 * Separates general FX-week status from Vantage standard XAUUSD trading hours.
 * Times are expressed in America/New_York so DST shifts automatically.
 */
(() => {
  'use strict';

  const TZ = 'America/New_York';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  function parts(date) {
    const out = {};
    for (const p of formatter.formatToParts(date)) {
      if (p.type === 'literal') continue;
      out[p.type] = ['year','month','day','hour','minute','second'].includes(p.type) ? Number(p.value) : p.value;
    }
    return out;
  }

  function localCalendar(date) {
    const p = parts(date);
    return new Date(Date.UTC(p.year, p.month - 1, p.day));
  }

  function shiftCalendar(day, delta) {
    return new Date(day.getTime() + delta * 86400000);
  }

  function getOffsetMs(date) {
    const p = parts(date);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUTC - date.getTime() + date.getUTCMilliseconds();
  }

  function localInstant(day, hour, minute) {
    const target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute, 0, 0);
    let guess = new Date(target);
    for (let i = 0; i < 3; i++) guess = new Date(target - getOffsetMs(guess));
    return guess;
  }

  function localDow(now) {
    return localCalendar(now).getUTCDay();
  }

  function localMinutes(now) {
    const p = parts(now);
    return p.hour * 60 + p.minute + p.second / 60;
  }

  function nextDowTarget(now, targetDow, hour, minute, allowToday) {
    const today = localCalendar(now);
    const dow = today.getUTCDay();
    let delta = (targetDow - dow + 7) % 7;
    if (delta === 0 && !allowToday) delta = 7;
    return localInstant(shiftCalendar(today, delta), hour, minute);
  }

  function forexStatus(now) {
    const dow = localDow(now);
    const min = localMinutes(now);
    let open = false;
    if (dow >= 1 && dow <= 4) open = true;
    else if (dow === 5) open = min < 17 * 60;
    else if (dow === 0) open = min >= 17 * 60;

    let next;
    if (open) {
      next = dow === 5
        ? localInstant(localCalendar(now), 17, 0)
        : nextDowTarget(now, 5, 17, 0, false);
    } else {
      if (dow === 0 && min < 17 * 60) next = localInstant(localCalendar(now), 17, 0);
      else next = nextDowTarget(now, 0, 17, 0, false);
    }
    return { open, next };
  }

  function xauStatus(now) {
    const dow = localDow(now);
    const min = localMinutes(now);
    const reopen = 18 * 60 + 1;
    const dailyClose = 16 * 60 + 59;
    const fridayClose = 16 * 60 + 58;
    let open = false;

    if (dow === 0) open = min >= reopen;
    else if (dow >= 1 && dow <= 4) open = min < dailyClose || min >= reopen;
    else if (dow === 5) open = min < fridayClose;

    const today = localCalendar(now);
    let next;
    if (open) {
      if (dow === 0) next = localInstant(shiftCalendar(today, 1), 16, 59);
      else if (dow >= 1 && dow <= 3) next = min < dailyClose ? localInstant(today, 16, 59) : localInstant(shiftCalendar(today, 1), 16, 59);
      else if (dow === 4) next = min < dailyClose ? localInstant(today, 16, 59) : localInstant(shiftCalendar(today, 1), 16, 58);
      else if (dow === 5) next = localInstant(today, 16, 58);
    } else {
      if (dow === 0 && min < reopen) next = localInstant(today, 18, 1);
      else if (dow >= 1 && dow <= 4 && min >= dailyClose && min < reopen) next = localInstant(today, 18, 1);
      else next = nextDowTarget(now, 0, 18, 1, false);
    }
    return { open, next };
  }

  function fmtCountdown(ms) {
    let s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); const sec = s % 60;
    return (d ? `${d}d ` : '') + `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`;
  }

  function labels() {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'pt');
    const table = {
      pt: { open:'ABERTO', closed:'FECHADO', opens:'abre em', closes:'fecha em' },
      es: { open:'ABIERTO', closed:'CERRADO', opens:'abre en', closes:'cierra en' },
      en: { open:'OPEN', closed:'CLOSED', opens:'opens in', closes:'closes in' },
      fr: { open:'OUVERT', closed:'FERMÉ', opens:'ouvre dans', closes:'ferme dans' }
    };
    return table[lang] || table.pt;
  }

  function ensureUI() {
    if (document.getElementById('r3r-broker-status')) return;
    const host = document.querySelector('.clock-wrapper') || document.body;
    const style = document.createElement('style');
    style.textContent = `
      #r3r-broker-status{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:40;display:flex;gap:7px;pointer-events:none;font-family:Inter,"Segoe UI",system-ui,sans-serif}
      .r3r-broker-pill{display:flex;align-items:center;gap:7px;padding:5px 9px;border:1px solid var(--panel-border);border-radius:999px;background:color-mix(in srgb,var(--panel-bg) 94%,transparent);backdrop-filter:blur(10px);box-shadow:0 0 14px rgba(0,0,0,.28);white-space:nowrap;font-size:10px;font-weight:800;letter-spacing:.03em}
      .r3r-broker-pill .dot{width:7px;height:7px;border-radius:50%;background:#777;box-shadow:0 0 7px currentColor}
      .r3r-broker-pill.open{color:#67e88f;border-color:color-mix(in srgb,#67e88f 45%,var(--panel-border))}
      .r3r-broker-pill.open .dot{background:#38d66b}
      .r3r-broker-pill.closed{color:#ffb34d;border-color:color-mix(in srgb,#ffb34d 42%,var(--panel-border))}
      .r3r-broker-pill.closed .dot{background:#ff9b26}
      .r3r-broker-pill .meta{color:var(--text-dim);font-weight:650;letter-spacing:0}
      @media(max-width:800px){#r3r-broker-status{top:6px;gap:4px;max-width:94%;flex-wrap:wrap;justify-content:center}.r3r-broker-pill{padding:4px 7px;font-size:9px}}
    `;
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.id = 'r3r-broker-status';
    box.innerHTML = `
      <div class="r3r-broker-pill" id="r3r-forex-pill"><span class="dot"></span><span>FOREX</span><span class="state"></span><span class="meta"></span></div>
      <div class="r3r-broker-pill" id="r3r-xau-pill"><span class="dot"></span><span>XAUUSD VANTAGE</span><span class="state"></span><span class="meta"></span></div>`;
    host.appendChild(box);
  }

  function paint(id, status, now) {
    const el = document.getElementById(id);
    if (!el) return;
    const l = labels();
    el.classList.toggle('open', status.open);
    el.classList.toggle('closed', !status.open);
    el.querySelector('.state').textContent = status.open ? l.open : l.closed;
    el.querySelector('.meta').textContent = `${status.open ? l.closes : l.opens} ${fmtCountdown(status.next - now)}`;
  }

  function update() {
    ensureUI();
    const now = new Date();
    paint('r3r-forex-pill', forexStatus(now), now);
    paint('r3r-xau-pill', xauStatus(now), now);
  }

  update();
  setInterval(update, 1000);
})();
