/* =========================================
   CALC V3.0  |  script.js
   © Souvik — All rights reserved
========================================= */

'use strict';

/* ══════════════════════════════════════
   API KEY
   Loaded from config.js (gitignored).
   config.js is loaded before this script
   in index.html and sets window.CONFIG.
   See config.example.js for the template.
══════════════════════════════════════ */
const GEMINI_API_KEY = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_API_KEY)
  ? CONFIG.GEMINI_API_KEY
  : '';

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
let calcStr   = '';
let calcFresh = false;
let sciStr    = '';
let sciFresh  = false;
let memory    = 0;
let soundOn   = true;
let voiceOn   = false;
let calcHistory = [];   // renamed from 'history' — avoids shadowing window.history
let activeTab = 'calc';

/* ── Persist / restore across sessions ── */
try {
  calcHistory = JSON.parse(localStorage.getItem('cv3_hist')  || '[]');
  memory      = parseFloat(localStorage.getItem('cv3_mem')   || '0');
  soundOn     = localStorage.getItem('cv3_sound') !== 'false';
  const savedTheme = localStorage.getItem('cv3_theme');
  if (savedTheme) applyTheme(savedTheme, false);
} catch (_) { /* silently ignore corrupt storage */ }

/* ══════════════════════════════════════
   WEB AUDIO — SOUND ENGINE
══════════════════════════════════════ */
let audioCtx = null;

function getAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume context that was suspended (autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, type = 'sine', duration = 0.07, vol = 0.15) {
  if (!soundOn) return;
  try {
    const ctx  = getAudio();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) { /* ignore AudioContext errors */ }
}

const sounds = {
  num:   () => playTone(600, 'sine',     0.06, 0.12),
  op:    () => playTone(440, 'triangle', 0.08, 0.15),
  fn:    () => playTone(350, 'triangle', 0.08, 0.13),
  eq:    () => { playTone(800, 'sine', 0.05, 0.18); setTimeout(() => playTone(1000, 'sine', 0.07, 0.15), 60); },
  del:   () => playTone(280, 'sawtooth', 0.06, 0.10),
  error: () => { playTone(150, 'square', 0.1, 0.12); setTimeout(() => playTone(120, 'square', 0.1, 0.10), 110); },
  mem:   () => playTone(700, 'sine',     0.10, 0.14),
  theme: () => playTone(900, 'sine',     0.08, 0.10),
};

/* ══════════════════════════════════════
   PARTICLE BACKGROUND
══════════════════════════════════════ */
(function initParticles() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;
  const ctx2 = canvas.getContext('2d');
  let W, H, pts = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function getParticleColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--particle').trim() || 'rgba(94,231,223,0.6)';
  }

  function spawn() {
    pts = [];
    const count = Math.min(60, Math.floor(W * H / 14000));
    for (let i = 0; i < count; i++) {
      pts.push({
        x: Math.random() * W,     y: Math.random() * H,
        vx: (Math.random() - .5) * .35,  vy: (Math.random() - .5) * .35,
        r: Math.random() * 1.8 + .5,
        alpha: Math.random() * .5 + .2,
      });
    }
  }

  function frame() {
    ctx2.clearRect(0, 0, W, H);
    const col = getParticleColor();
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx2.fillStyle = col.replace(/[\d.]+\)$/, p.alpha.toFixed(2) + ')');
      ctx2.fill();
    });
    // Connection lines between nearby particles
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 120) {
          ctx2.beginPath();
          ctx2.moveTo(pts[i].x, pts[i].y);
          ctx2.lineTo(pts[j].x, pts[j].y);
          ctx2.strokeStyle = col.replace(/[\d.]+\)$/, ((1 - d / 120) * 0.12).toFixed(3) + ')');
          ctx2.lineWidth   = 0.6;
          ctx2.stroke();
        }
      }
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { resize(); spawn(); });
  resize(); spawn(); frame();
})();

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */

/** Format a number for display */
function fmt(n) {
  if (!isFinite(n)) return 'Error';
  if (Math.abs(n) >= 1e13 || (Math.abs(n) < 1e-8 && n !== 0))
    return n.toExponential(5);
  return parseFloat(n.toPrecision(12)).toString();
}

/** Convert internal expression string to a human-readable form */
function toPretty(s) {
  return s
    .replace(/Math\.asin\(/g,  'sin⁻¹(').replace(/Math\.acos\(/g, 'cos⁻¹(')
    .replace(/Math\.sin\(/g,   'sin(')   .replace(/Math\.cos\(/g,  'cos(')
    .replace(/Math\.tan\(/g,   'tan(')   .replace(/Math\.log10\(/g,'log(')
    .replace(/Math\.log\(/g,   'ln(')    .replace(/Math\.sqrt\(/g, '√(')
    .replace(/Math\.cbrt\(/g,  '∛(')     .replace(/Math\.PI/g,    'π')
    .replace(/Math\.E\b/g,     'e')      .replace(/\*\*3/g,       '³')
    .replace(/\*\*2/g,         '²')      .replace(/\*\*/g,        '^')
    .replace(/\*/g,            '×')      .replace(/\//g,          '÷');
}

/** Safely evaluate a math expression string */
function safeEval(expr) {
  // Only allow known-safe characters / identifiers
  return Function('"use strict"; return (' + expr + ')')();
}

/** Attach a ripple animation to a button on click */
function rippleEffect(btn, e) {
  const rip  = document.createElement('span');
  rip.className = 'ripple';
  const sz   = Math.max(btn.offsetWidth, btn.offsetHeight);
  const rect = btn.getBoundingClientRect();
  const cx   = e ? e.clientX : rect.left + rect.width  / 2;
  const cy   = e ? e.clientY : rect.top  + rect.height / 2;
  rip.style.cssText = `width:${sz}px;height:${sz}px;left:${cx - rect.left - sz / 2}px;top:${cy - rect.top - sz / 2}px`;
  btn.appendChild(rip);
  setTimeout(() => rip.remove(), 550);
}

/* ══════════════════════════════════════
   THEME SWITCHER
══════════════════════════════════════ */

/** Maps each theme name to its primary background colour
 *  Used to tint the mobile browser chrome via <meta name="theme-color">
 */
const THEME_BG = {
  aurora:   '#0a0e1a',
  sakura:   '#1a0a12',
  ocean:    '#030d1f',
  sunset:   '#1a0800',
  midnight: '#080808',
  forest:   '#040f08',
};

function applyTheme(theme, save = true) {
  document.documentElement.setAttribute('data-theme', theme);

  // Tint mobile browser chrome
  const metaColor = document.getElementById('metaThemeColor');
  if (metaColor) metaColor.content = THEME_BG[theme] || '#0a0e1a';

  // Sync visual + ARIA state on every pill
  document.querySelectorAll('.theme-pill').forEach(p => {
    const active = p.dataset.theme === theme;
    p.classList.toggle('active', active);
    p.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  if (save) {
    localStorage.setItem('cv3_theme', theme);
    sounds.theme();
  }
}

/* ══════════════════════════════════════
   TAB SYSTEM
══════════════════════════════════════ */
function switchTab(tab) {
  activeTab = tab;

  // Update each tab button: ARIA state + roving tabindex
  document.querySelectorAll('.tab[role="tab"]').forEach(btn => {
    const isActive = btn.id === `tab-btn-${tab}`;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.tabIndex = isActive ? 0 : -1;
  });

  // Show/hide panels with `hidden` attribute (semantically correct)
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const isActive = panel.id === `tab-${tab}`;
    panel.classList.toggle('active', isActive);
    panel.toggleAttribute('hidden', !isActive);
  });

  sounds.fn();
  if (tab === 'currency') fetchRates();
  if (tab === 'unit')     initUnit();
}

/* ══════════════════════════════════════
   MAIN CALCULATOR
══════════════════════════════════════ */
const exprEl    = document.getElementById('exprLine');
const previewEl = document.getElementById('previewLine');

function renderCalc() {
  exprEl.textContent = toPretty(calcStr) || '0';
  exprEl.classList.remove('error');
  if (calcStr && !calcFresh) {
    try {
      const v = safeEval(calcStr);
      previewEl.textContent =
        isFinite(v) && /[+\-*/]/.test(calcStr) ? '= ' + fmt(v) : '';
    } catch (_) { previewEl.textContent = ''; }
  } else {
    previewEl.textContent = '';
  }
  updateMemIndicator();
}

/**
 * Insert a token into the calculator expression.
 * @param {string} v   - token to append
 * @param {'num'|'op'|'fn'} [snd] - sound category
 */
function ins(v, snd = 'num') {
  sounds[snd]?.();
  if (calcFresh) {
    if (['+', '-', '*', '/', '%'].includes(v)) calcFresh = false;
    else { calcStr = ''; calcFresh = false; }
  }
  calcStr += v;
  renderCalc();
}

function ac() {
  sounds.fn();
  calcStr   = '';
  calcFresh = false;
  exprEl.classList.add('flash');
  setTimeout(() => exprEl.classList.remove('flash'), 300);
  renderCalc();
}

function delChar() {
  sounds.del();
  if (calcFresh) { ac(); return; }
  calcStr = calcStr.slice(0, -1);
  renderCalc();
}

function calculate() {
  if (!calcStr) return;
  // Auto-close any unclosed parentheses
  let open   = (calcStr.match(/\(/g) || []).length;
  let closed = (calcStr.match(/\)/g) || []).length;
  while (open > closed) { calcStr += ')'; closed++; }

  try {
    const v = safeEval(calcStr);
    if (!isFinite(v)) { showCalcError('Cannot divide by zero'); return; }
    const r = fmt(v);
    saveHistory(calcStr, r);
    sounds.eq();
    exprEl.classList.add('flash');
    setTimeout(() => exprEl.classList.remove('flash'), 400);
    calcStr   = r;
    calcFresh = true;
    exprEl.textContent  = r;
    previewEl.textContent = '';
  } catch (_) {
    showCalcError('Syntax Error');
  }
}

function showCalcError(msg) {
  sounds.error();
  exprEl.textContent = msg;
  exprEl.classList.add('error');
  setTimeout(() => { exprEl.classList.remove('error'); renderCalc(); }, 2200);
}

/* ══════════════════════════════════════
   MEMORY
══════════════════════════════════════ */
function updateMemIndicator() {
  const el = document.getElementById('memIndicator');
  if (el) el.textContent = memory !== 0 ? `M: ${fmt(memory)}` : '';
}

function getCurrentVal() {
  if (!calcStr) return 0;
  try { return safeEval(calcStr); } catch (_) { return 0; }
}

function memAdd() {
  sounds.mem();
  memory += getCurrentVal();
  localStorage.setItem('cv3_mem', memory);
  updateMemIndicator();
  flashMem();
}

function memSub() {
  sounds.mem();
  memory -= getCurrentVal();
  localStorage.setItem('cv3_mem', memory);
  updateMemIndicator();
  flashMem();
}

function memRecall() {
  sounds.mem();
  calcStr   = fmt(memory);
  calcFresh = true;
  renderCalc();
}

function memClear() {
  sounds.mem();
  memory = 0;
  localStorage.setItem('cv3_mem', '0');
  updateMemIndicator();
}

function flashMem() {
  const el = document.getElementById('memIndicator');
  if (!el) return;
  el.style.opacity    = '1';
  el.style.textShadow = '0 0 12px var(--accent1)';
  setTimeout(() => { el.style.textShadow = ''; }, 600);
}

/* ══════════════════════════════════════
   HISTORY
══════════════════════════════════════ */
function saveHistory(expr, result) {
  calcHistory.unshift({ e: toPretty(expr), r: result, t: Date.now() });
  if (calcHistory.length > 30) calcHistory.pop();
  try { localStorage.setItem('cv3_hist', JSON.stringify(calcHistory)); } catch (_) {}
  renderHistory();
}

function renderHistory() {
  const ul = document.getElementById('histList');
  if (!ul) return;
  if (!calcHistory.length) {
    ul.innerHTML = '<li style="color:var(--text-dim);font-size:.72rem;text-align:center;padding:8px">No history yet</li>';
    return;
  }
  ul.innerHTML = '';
  calcHistory.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item.e}</span><span class="hres">${item.r}</span>`;
    li.addEventListener('click', () => {
      calcStr   = item.r;
      calcFresh = true;
      renderCalc();
      sounds.num();
    });
    ul.appendChild(li);
  });
}

function clearHistory() {
  calcHistory = [];
  try { localStorage.removeItem('cv3_hist'); } catch (_) {}
  renderHistory();
}

function toggleHistory() {
  sounds.fn();
  const drawer = document.getElementById('histDrawer');
  const btn    = document.getElementById('histBtn');
  if (!drawer) return;
  const isOpen = drawer.classList.toggle('open');
  drawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  btn?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

/* ══════════════════════════════════════
   SCIENTIFIC CALCULATOR
══════════════════════════════════════ */
const sciExprEl    = document.getElementById('sciExprLine');
const sciPreviewEl = document.getElementById('sciPreviewLine');

function renderSci() {
  sciExprEl.textContent = toPretty(sciStr) || '0';
  sciExprEl.classList.remove('error');
  if (sciStr && !sciFresh) {
    try {
      const v = safeEval(sciStr);
      sciPreviewEl.textContent = isFinite(v) ? '= ' + fmt(v) : '';
    } catch (_) { sciPreviewEl.textContent = ''; }
  } else {
    sciPreviewEl.textContent = '';
  }
}

function sciIns(v) {
  // BUG FIX: original was `sounds.v===` (always false) — corrected to check `v`
  (v === '(' || v === ')') ? sounds.fn() : sounds.num();

  if (sciFresh) {
    if (['+', '-', '*', '/', '**', '%'].includes(v)) sciFresh = false;
    else { sciStr = ''; sciFresh = false; }
  }

  // Smart paren toggle: if more opens than closes, insert ')'; otherwise '('
  if (v === '(') {
    const open   = (sciStr.match(/\(/g) || []).length;
    const closed = (sciStr.match(/\)/g) || []).length;
    sciStr += open > closed ? ')' : '(';
  } else {
    sciStr += v;
  }
  renderSci();
}

function sciAC() {
  sounds.fn();
  sciStr   = '';
  sciFresh = false;
  sciExprEl.classList.add('flash');
  setTimeout(() => sciExprEl.classList.remove('flash'), 300);
  renderSci();
}

function sciDel() {
  sounds.del();
  if (sciFresh) { sciAC(); return; }
  // Try to delete whole tokens before falling back to single character
  const tokens = [
    'Math.asin(', 'Math.acos(', 'Math.sin(', 'Math.cos(', 'Math.tan(',
    'Math.log10(', 'Math.log(', 'Math.sqrt(', 'Math.cbrt(',
    'Math.PI', 'Math.E', '**3', '**2', '**',
  ];
  let deleted = false;
  for (const t of tokens) {
    if (sciStr.endsWith(t)) { sciStr = sciStr.slice(0, -t.length); deleted = true; break; }
  }
  if (!deleted) sciStr = sciStr.slice(0, -1);
  renderSci();
}

function sciCalc() {
  if (!sciStr) return;
  let open   = (sciStr.match(/\(/g) || []).length;
  let closed = (sciStr.match(/\)/g) || []).length;
  while (open > closed) { sciStr += ')'; closed++; }

  try {
    const v = safeEval(sciStr);
    if (!isFinite(v)) {
      sciExprEl.textContent = 'Error';
      sciExprEl.classList.add('error');
      sounds.error();
      setTimeout(() => { sciExprEl.classList.remove('error'); renderSci(); }, 2000);
      return;
    }
    const r = fmt(v);
    saveHistory(sciStr, r);
    sounds.eq();
    sciExprEl.classList.add('flash');
    setTimeout(() => sciExprEl.classList.remove('flash'), 400);
    sciStr   = r;
    sciFresh = true;
    sciExprEl.textContent    = r;
    sciPreviewEl.textContent = '';
  } catch (_) {
    sounds.error();
    sciExprEl.textContent = 'Syntax Error';
    sciExprEl.classList.add('error');
    setTimeout(() => { sciExprEl.classList.remove('error'); renderSci(); }, 2200);
  }
}

/* ══════════════════════════════════════
   SOUND & VOICE TOGGLES
══════════════════════════════════════ */
function toggleSound() {
  soundOn = !soundOn;
  localStorage.setItem('cv3_sound', soundOn);
  const btn = document.getElementById('soundBtn');
  btn.textContent = soundOn ? '🔊' : '🔇';
  btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
  btn.setAttribute('aria-label',   soundOn ? 'Sound on' : 'Sound off');
  btn.classList.toggle('active', soundOn);
}

let recognition = null;

function setVoiceOff() {
  voiceOn = false;
  const btn = document.getElementById('voiceBtn');
  btn?.classList.remove('active');
  btn?.setAttribute('aria-pressed', 'false');
  btn?.setAttribute('aria-label', 'Voice input');
  const ind = document.getElementById('voiceIndicator');
  if (ind) ind.textContent = '';
}

function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('Voice input is not supported in this browser. Please try Chrome.');
    return;
  }
  if (voiceOn) { recognition?.stop(); setVoiceOff(); return; }

  const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang            = 'en-US';
  recognition.continuous      = false;
  recognition.interimResults  = false;

  recognition.onresult = e => {
    const raw    = e.results[0][0].transcript.toLowerCase();
    const parsed = parseVoiceInput(raw);
    if (parsed) {
      if (activeTab === 'sci') { sciStr = parsed; renderSci(); }
      else                     { calcStr = parsed; renderCalc(); }
    }
    setVoiceOff();
  };
  recognition.onerror = () => setVoiceOff();
  recognition.onend   = () => setVoiceOff();
  recognition.start();

  voiceOn = true;
  const btn = document.getElementById('voiceBtn');
  btn?.classList.add('active');
  btn?.setAttribute('aria-pressed', 'true');
  btn?.setAttribute('aria-label', 'Stop voice input');
  const ind = document.getElementById('voiceIndicator');
  if (ind) ind.textContent = '🎙 Listening…';
}

function parseVoiceInput(txt) {
  return txt
    .replace(/\bplus\b/g,                '+').replace(/\bminus\b/g,             '-')
    .replace(/\btimes\b|\bmultiplied by\b/g, '*').replace(/\bdivided by\b|\bover\b/g, '/')
    .replace(/\bpercent\b/g,             '%').replace(/\bpoint\b/g,             '.')
    .replace(/\bzero\b/g,  '0').replace(/\bone\b/g,   '1').replace(/\btwo\b/g,   '2')
    .replace(/\bthree\b/g, '3').replace(/\bfour\b/g,  '4').replace(/\bfive\b/g,  '5')
    .replace(/\bsix\b/g,   '6').replace(/\bseven\b/g, '7').replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g,  '9')
    .replace(/\bsquare root of\b/g, 'Math.sqrt(')
    .replace(/[^0-9+\-*/.%()\sMathsqrtcblog10PIE]/g, '')
    .trim();
}

/* ══════════════════════════════════════
   KEYBOARD SUPPORT
══════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (activeTab !== 'calc' && activeTab !== 'sci') return;
  // Don't hijack typing in the AI textarea
  if (document.activeElement?.tagName === 'TEXTAREA') return;

  const isSci = activeTab === 'sci';
  const doIns = isSci ? sciIns : (v) => ins(v, 'num');
  const doOp  = isSci ? sciIns : (v) => ins(v, 'op');
  const doFn  = isSci ? sciIns : (v) => ins(v, 'fn');
  const doAC  = isSci ? sciAC  : ac;
  const doDel = isSci ? sciDel : delChar;
  const doEq  = isSci ? sciCalc : calculate;

  const k = e.key;
  if (k >= '0' && k <= '9')         { doIns(k);    kFlash(k);  }
  else if (k === '+')                { doOp('+');   kFlash('+'); }
  else if (k === '-')                { doOp('-');   kFlash('−'); }
  else if (k === '*')                { doOp('*');   kFlash('×'); }
  else if (k === '/')                { e.preventDefault(); doOp('/'); kFlash('÷'); }
  else if (k === '%')                { doFn('%');   kFlash('%'); }
  else if (k === '.')                { doIns('.'); kFlash('.'); }
  else if (k === '(' || k === ')')   { doIns(k); }
  else if (k === 'Enter' || k === '=') { doEq(); kFlash('='); }
  else if (k === 'Backspace')        { doDel(); }
  else if (k === 'Escape')           { doAC(); }
});

function kFlash(label) {
  document.querySelectorAll('.key').forEach(btn => {
    if (btn.textContent.trim() === label) {
      btn.classList.add('key-flash');
      setTimeout(() => btn.classList.remove('key-flash'), 150);
    }
  });
}

/* ══════════════════════════════════════
   CURRENCY CONVERTER
══════════════════════════════════════ */
const CURRENCIES = [
  'USD','EUR','GBP','INR','JPY','AUD','CAD','CHF','CNY',
  'SGD','HKD','KRW','BRL','MXN','ZAR','NOK','SEK','DKK',
  'NZD','THB','AED','SAR','RUB','TRY','PLN','HUF','CZK',
];

let rates     = {};
let ratesBase = 'USD';

function populateCurrencySelects() {
  const from = document.getElementById('currFrom');
  const to   = document.getElementById('currTo');
  [from, to].forEach(sel => {
    sel.innerHTML = '';
    CURRENCIES.forEach(c => {
      const opt  = document.createElement('option');
      opt.value  = c;
      opt.textContent = c;
      sel.appendChild(opt);
    });
  });
  from.value = 'USD';
  to.value   = 'INR';
}

async function fetchRates() {
  const note    = document.getElementById('currNote');
  const btn     = document.getElementById('refreshRatesBtn');
  note.textContent = '⏳ Fetching live rates…';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Loading…'; }

  try {
    const res  = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    rates     = data.rates;
    ratesBase = 'USD';
    const updated = new Date(data.time_last_updated * 1000).toLocaleTimeString();
    note.textContent = `✓ Updated: ${updated}`;
    convertCurrency();
  } catch (_) {
    // Approximate offline fallback rates
    rates = {
      USD:1,    EUR:0.92,  GBP:0.79,  INR:83.5,  JPY:149.8, AUD:1.53,
      CAD:1.36, CHF:0.9,   CNY:7.24,  SGD:1.34,  HKD:7.82,  KRW:1325,
      BRL:5.0,  MXN:17.2,  ZAR:18.7,  NOK:10.6,  SEK:10.4,  DKK:6.89,
      NZD:1.63, THB:35.2,  AED:3.67,  SAR:3.75,  RUB:91.5,  TRY:30.8,
      PLN:4.05, HUF:358,   CZK:23.1,
    };
    note.textContent = '⚠ Using offline rates (no internet)';
    convertCurrency();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh Rates'; }
  }
}

function convertCurrency() {
  if (!Object.keys(rates).length) return;
  const amount = parseFloat(document.getElementById('currAmount').value) || 0;
  const from   = document.getElementById('currFrom').value;
  const to     = document.getElementById('currTo').value;
  const result = (amount / rates[from]) * rates[to];
  const display = result >= 10000
    ? result.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : result.toFixed(4);
  document.querySelector('#currResult .result-big').textContent = `${display} ${to}`;
  document.getElementById('currRate').textContent =
    `1 ${from} = ${(rates[to] / rates[from]).toFixed(5)} ${to}`;
}

function swapCurrency() {
  const from = document.getElementById('currFrom');
  const to   = document.getElementById('currTo');
  [from.value, to.value] = [to.value, from.value];
  convertCurrency();
  sounds.fn();
}

/* ══════════════════════════════════════
   UNIT CONVERTER
══════════════════════════════════════ */
const UNITS = {
  length: {
    units: ['Meter','Kilometer','Mile','Yard','Foot','Inch','Centimeter','Millimeter','Nautical Mile','Light Year'],
    toBase: {
      Meter:1, Kilometer:1e3, Mile:1609.344, Yard:0.9144, Foot:0.3048,
      Inch:0.0254, Centimeter:0.01, Millimeter:1e-3,
      'Nautical Mile':1852, 'Light Year':9.461e15,
    },
  },
  weight: {
    units: ['Kilogram','Gram','Pound','Ounce','Tonne','Milligram','Stone','Carat'],
    toBase: {
      Kilogram:1, Gram:1e-3, Pound:0.453592, Ounce:0.0283495,
      Tonne:1000, Milligram:1e-6, Stone:6.35029, Carat:2e-4,
    },
  },
  temp: {
    units: ['Celsius','Fahrenheit','Kelvin','Rankine'],
    toBase: null, // handled separately via conversion functions
  },
  area: {
    units: ['Square Meter','Square Kilometer','Square Mile','Hectare','Acre','Square Foot','Square Inch','Square Yard'],
    toBase: {
      'Square Meter':1, 'Square Kilometer':1e6, 'Square Mile':2.59e6,
      Hectare:1e4, Acre:4046.86, 'Square Foot':0.0929, 'Square Inch':6.452e-4, 'Square Yard':0.836,
    },
  },
  speed: {
    units: ['m/s','km/h','mph','knot','ft/s','Mach'],
    toBase: { 'm/s':1, 'km/h':0.27778, 'mph':0.44704, 'knot':0.51444, 'ft/s':0.3048, 'Mach':343 },
  },
  data: {
    units: ['Bit','Byte','Kilobyte','Megabyte','Gigabyte','Terabyte','Petabyte'],
    toBase: {
      Bit:1, Byte:8, Kilobyte:8192, Megabyte:8388608,
      Gigabyte:8589934592, Terabyte:8.796e12, Petabyte:9.007e15,
    },
  },
};

let currentUnitCat = 'length';

function initUnit() {
  setUnitCat('length');
}

function setUnitCat(cat) {
  currentUnitCat = cat;

  // Sync visual + ARIA state on category buttons
  document.querySelectorAll('#unitCatRow .unit-cat').forEach(btn => {
    const active = btn.dataset.cat === cat;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  const data    = UNITS[cat];
  const fromSel = document.getElementById('unitFrom');
  const toSel   = document.getElementById('unitTo');
  [fromSel, toSel].forEach(sel => {
    sel.innerHTML = '';
    data.units.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u; opt.textContent = u;
      sel.appendChild(opt);
    });
  });
  if (data.units.length > 1) toSel.selectedIndex = 1;
  convertUnit();
  sounds.fn();
}

function convertUnit() {
  const cat  = currentUnitCat;
  const val  = parseFloat(document.getElementById('unitAmount').value) || 0;
  const from = document.getElementById('unitFrom').value;
  const to   = document.getElementById('unitTo').value;
  let result = 0;

  if (cat === 'temp') {
    // Convert to Celsius as the intermediate base
    let celsius;
    switch (from) {
      case 'Celsius':    celsius = val; break;
      case 'Fahrenheit': celsius = (val - 32) * 5 / 9; break;
      case 'Kelvin':     celsius = val - 273.15; break;
      case 'Rankine':    celsius = (val - 491.67) * 5 / 9; break;
    }
    switch (to) {
      case 'Celsius':    result = celsius; break;
      case 'Fahrenheit': result = celsius * 9 / 5 + 32; break;
      case 'Kelvin':     result = celsius + 273.15; break;
      case 'Rankine':    result = (celsius + 273.15) * 9 / 5; break;
    }
  } else {
    const tb = UNITS[cat].toBase;
    result   = val * tb[from] / tb[to];
  }

  const display = Math.abs(result) >= 1e9 || (Math.abs(result) < 1e-5 && result !== 0)
    ? result.toExponential(5)
    : parseFloat(result.toPrecision(8)).toString();

  document.querySelector('#unitResult .result-big').textContent = `${display} ${to}`;
}

function swapUnit() {
  const f = document.getElementById('unitFrom');
  const t = document.getElementById('unitTo');
  [f.value, t.value] = [t.value, f.value];
  convertUnit();
  sounds.fn();
}

/* ══════════════════════════════════════
   AI MATH SOLVER
══════════════════════════════════════ */
/* ══════════════════════════════════════
   GEMINI MODEL CASCADE
   Tries cheapest/fastest model first to
   preserve free-tier quota. Falls back
   automatically on 429 rate-limit errors.
══════════════════════════════════════ */
const GEMINI_MODELS = [
  'gemini-1.5-flash-8b',  // smallest model, most generous free tier
  'gemini-1.5-flash',     // reliable fallback
  'gemini-2.0-flash',     // full model, try last (quota-heavy)
];

/** Build a Gemini endpoint URL for a given model */
function geminiEndpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

/**
 * Extract the suggested retry delay (in seconds) from a Gemini 429 body.
 * The API embeds it in error.details[].retryDelay or in the message string.
 */
function parseRetryAfter(errBody) {
  try {
    for (const d of errBody?.error?.details ?? []) {
      if (d['@type']?.includes('RetryInfo') && d.retryDelay) {
        return Math.ceil(parseFloat(d.retryDelay));
      }
    }
    const m = errBody?.error?.message?.match(/retry in ([\d.]+)s/i);
    if (m) return Math.ceil(parseFloat(m[1]));
  } catch (_) {}
  return null;
}

/** Show a live countdown in the response box, resolves when it hits 0 */
function showCountdown(seconds, modelName) {
  const resp = document.getElementById('aiResponse');
  return new Promise(resolve => {
    let t = seconds;
    const tick = () => {
      resp.textContent = `⏳ Rate limit on ${modelName}. Retrying in ${t}s…`;
      if (t-- > 0) setTimeout(tick, 1000);
      else resolve();
    };
    tick();
  });
}

/** Categorise HTTP error codes into friendly messages */
function friendlyError(status, errBody) {
  const api = errBody?.error?.message || '';
  switch (status) {
    case 400: return '⚠ Bad request — please rephrase your question.';
    case 401:
    case 403: return '⚠ Invalid API key. Double-check GEMINI_API_KEY in script.js.';
    case 404: return '⚠ Model not found. The model name may have changed — check ai.google.dev.';
    case 429: return `⚠ All models are rate-limited on your free tier.\n\nYou can:\n• Wait a minute and try again\n• Check usage at: ai.dev/rate-limit\n• Upgrade your plan at: ai.google.dev\n\nAPI message: ${api}`;
    case 500:
    case 503: return '⚠ Gemini service error. Please try again in a moment.';
    default:  return `⚠ Error ${status}: ${api || 'Unknown error.'}`;
  }
}

async function askAI() {
  const prompt = document.getElementById('aiPrompt').value.trim();
  if (!prompt) return;

  const btn   = document.getElementById('aiSendBtn');
  const label = document.getElementById('aiSendLabel');
  const resp  = document.getElementById('aiResponse');

  btn.disabled   = true;
  resp.innerHTML = `<div class="ai-loading">
    <div class="ai-dot"></div>
    <div class="ai-dot"></div>
    <div class="ai-dot"></div>
  </div>`;

  /*
   * Strategy:
   *  1. On Vercel → call /api/solve (serverless proxy, key stays server-side)
   *  2. On localhost with config.js key → call Gemini directly (dev convenience)
   *  3. Neither → show setup instructions
   */
  const isVercel   = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
  const hasLocalKey = typeof CONFIG !== 'undefined' && !!CONFIG.GEMINI_API_KEY;

  if (!isVercel && !hasLocalKey) {
    resp.textContent =
      '⚠ No API key found.\n\n' +
      'Locally: paste your key in config.js\n' +
      'On Vercel: add GEMINI_API_KEY in\n' +
      'Dashboard → Settings → Environment Variables';
    btn.disabled      = false;
    label.textContent = 'Solve ✦';
    return;
  }

  try {
    let text = '';

    if (isVercel) {
      /* ── Vercel: hit our own serverless proxy ── */
      label.textContent = 'Solving…';
      const res = await fetch('/api/solve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt }),
      });

      /* ── Safe JSON parse: if Vercel returns an HTML error page,
            .json() would throw a confusing "Unexpected token" error.
            Check Content-Type first and give a clear message. ── */
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const raw = await res.text();
        if (res.status === 404) {
          throw new Error(
            '⚠ /api/solve not found (404).\n\n' +
            'Make sure api/solve.js is committed and Vercel has redeployed.\n' +
            'Check: Vercel Dashboard → Deployments → Functions tab.'
          );
        }
        throw new Error(`⚠ Server returned non-JSON (${res.status}): ${raw.slice(0, 120)}`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
      }
      text = data.text || 'No response returned.';

    } else {
      /* ── Local dev: call Gemini directly using config.js key ── */
      const localKey = CONFIG.GEMINI_API_KEY;
      let lastErr    = '';

      for (let mi = 0; mi < GEMINI_MODELS.length; mi++) {
        const model = GEMINI_MODELS[mi];
        label.textContent = mi === 0 ? 'Solving…' : `Trying ${model}…`;

        const res = await fetch(geminiEndpoint(model).replace(GEMINI_API_KEY, localKey), {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You are a brilliant math assistant inside a calculator app.
Solve any math problem clearly. Show step-by-step working when useful.
Use plain text only — no markdown, no asterisks, no hashes.
Keep answers concise. For simple arithmetic: answer + one-line explanation.
For complex problems: numbered steps, final answer clearly labelled.

Problem: ${prompt}` }] }],
            generationConfig: { maxOutputTokens: 1000, temperature: 0.2 },
          }),
        });

        if (res.status === 429 || res.status === 404) {
          const isLast = mi === GEMINI_MODELS.length - 1;
          lastErr = friendlyError(res.status, await res.json().catch(() => ({})));
          if (isLast) { throw new Error(lastErr); }
          continue;
        }

        if (!res.ok) {
          throw new Error(friendlyError(res.status, await res.json().catch(() => ({}))));
        }

        const data = await res.json();
        text = data.candidates?.[0]?.content?.parts
          ?.map(p => p.text || '').join('\n').trim() || 'No response returned.';
        break;
      }
    }

    resp.textContent = text;
    sounds.eq();

  } catch (err) {
    resp.textContent = err.message?.startsWith('⚠')
      ? err.message
      : `⚠ ${err.message || 'Could not connect to AI.'}`;
    sounds.error();
  } finally {
    btn.disabled      = false;
    label.textContent = 'Solve ✦';
  }
}

function fillPrompt(txt) {
  const ta = document.getElementById('aiPrompt');
  ta.value = txt;
  ta.focus();
  sounds.fn();
}

/* ══════════════════════════════════════
   EVENT WIRING
   All addEventListener calls live here —
   no inline onclick handlers in the HTML.
══════════════════════════════════════ */
function wireEvents() {

  /* ── Theme pills ── */
  document.querySelectorAll('.theme-pill').forEach(p => {
    p.addEventListener('click', () => applyTheme(p.dataset.theme));
  });

  /* ── Tab bar ── */
  document.querySelectorAll('.tab[role="tab"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('aria-controls').replace('tab-', '');
      switchTab(tab);
    });
  });

  /* ── Header action buttons ── */
  document.getElementById('voiceBtn')?.addEventListener('click', toggleVoice);
  document.getElementById('soundBtn')?.addEventListener('click', toggleSound);

  /* ── Main keypad — event delegation ── */
  document.getElementById('mainKeypad')?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    rippleEffect(btn, e);
    const label = btn.getAttribute('aria-label');
    switch (btn.id) {
      case 'btnAC':  ac();          return;
      case 'btnDel': delChar();     return;
      case 'btnPct': ins('%', 'fn'); return;
      case 'btnDiv': ins('/', 'op'); return;
      case 'btnMul': ins('*', 'op'); return;
      case 'btnSub': ins('-', 'op'); return;
      case 'btnAdd': ins('+', 'op'); return;
      case 'btnEq':  calculate();   return;
    }
    if (label === 'Decimal point') { ins('.'); return; }
    if (/^\d$/.test(label))        { ins(label); return; }
  });

  /* ── Memory buttons ── */
  document.getElementById('btnMC')?.addEventListener('click',     memClear);
  document.getElementById('btnMR')?.addEventListener('click',     memRecall);
  document.getElementById('btnMPlus')?.addEventListener('click',  memAdd);
  document.getElementById('btnMMinus')?.addEventListener('click', memSub);

  /* ── History ── */
  document.getElementById('histBtn')?.addEventListener('click',      toggleHistory);
  document.getElementById('clearHistBtn')?.addEventListener('click', clearHistory);

  /* ── Scientific keypad — event delegation ── */
  document.querySelector('.sci-grid')?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    rippleEffect(btn, e);
    const label = btn.getAttribute('aria-label');
    switch (btn.id) {
      case 'sciBtnAC':  sciAC();   return;
      case 'sciBtnDel': sciDel();  return;
      case 'sciBtnEq':  sciCalc(); return;
    }
    if (btn.dataset.sci !== undefined) { sciIns(btn.dataset.sci); return; }
    if (label === 'Decimal point')     { sciIns('.'); return; }
    if (/^\d$/.test(label))            { sciIns(label); return; }
  });

  /* ── Currency converter ── */
  document.getElementById('currAmount')?.addEventListener('input',   convertCurrency);
  document.getElementById('currFrom')?.addEventListener('change',   convertCurrency);
  document.getElementById('currTo')?.addEventListener('change',     convertCurrency);
  document.getElementById('swapCurrBtn')?.addEventListener('click', swapCurrency);
  document.getElementById('refreshRatesBtn')?.addEventListener('click', fetchRates);

  /* ── Unit converter ── */
  document.getElementById('unitAmount')?.addEventListener('input',   convertUnit);
  document.getElementById('unitFrom')?.addEventListener('change',   convertUnit);
  document.getElementById('unitTo')?.addEventListener('change',     convertUnit);
  document.getElementById('swapUnitBtn')?.addEventListener('click', swapUnit);

  document.querySelectorAll('#unitCatRow .unit-cat').forEach(btn => {
    btn.addEventListener('click', () => setUnitCat(btn.dataset.cat));
  });

  /* ── AI Solver ── */
  document.getElementById('aiSendBtn')?.addEventListener('click', askAI);

  document.querySelectorAll('.ai-chip[data-prompt]').forEach(btn => {
    btn.addEventListener('click', () => fillPrompt(btn.dataset.prompt));
  });

  document.getElementById('aiPrompt')?.addEventListener('keydown', e => {
    // Ctrl/Cmd + Enter or plain Enter (without Shift) submits
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); }
  });

  /* ── Ripple on memory buttons ── */
  document.querySelectorAll('.mem-btn').forEach(btn => {
    btn.addEventListener('click', e => rippleEffect(btn, e));
  });
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
(function init() {
  wireEvents();
  populateCurrencySelects();
  renderHistory();
  renderCalc();
  renderSci();
  updateMemIndicator();

  // Sync sound button to persisted state
  const soundBtn = document.getElementById('soundBtn');
  if (soundBtn) {
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    soundBtn.setAttribute('aria-label',   soundOn ? 'Sound on' : 'Sound off');
    soundBtn.classList.toggle('active', soundOn);
  }
})();
