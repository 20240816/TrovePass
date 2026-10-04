// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
import {
generatePassword,
CHARSETS,
CLASS_ORDER,
normalizeClasses,
MIN_LENGTH,
MAX_LENGTH,
fingerprintFor,
BRAND,
} from '../dist/trovepass.js';

import { t, tn, setLocale, applyDom, preferredLocale, LOCALE_STORE_KEY } from './i18n.js';
import { loadOrCreateKey, seal, openEnvelope, isEnvelope, SEALED_STORE_KEY } from './envelope.js';
import { sealBackup, openBackup } from './backup.js';


const SETTINGS_STORE_KEY = 'trovepass.settings.v1';

const $ = (id) => document.getElementById(id);
const out = $('out');
const outBlockEl = $('out-block');
const copyBtn = $('copy');
const shareBtn = $('share');
const outRevealBtn = $('out-reveal');
const genActionsEl = $('gen-actions');
const clearLeftEl = $('clear-left');
const clearPauseBtn = $('clear-pause');
const status = $('status');
const errorEl = $('error');
const fingerprintEl = $('fingerprint');
const entriesEl = $('entries');
const entriesEmptyEl = $('entries-empty');
const entriesNoMatchEl = $('entries-nomatch');
const entriesStatus = $('entries-status');

const TABS = ['generate', 'entries', 'settings', 'about'];
let currentTab = 'generate';
const revealedKeys = new Set();
const secretShownKeys = new Set();
const openKeys = new Set();

let rowEpoch = 0;
let storeLoaded = false;

const panelsEl = $('panels');
let slideToken = 0;
let placement = 0;
const sectionRange = (from, to) =>
TABS.map((_, i) => i).filter((i) => i >= Math.min(from, to) && i <= Math.max(from, to));
function setVisible(keep) {
for (const [i, t] of TABS.entries()) {
$('panel-' + t).hidden = keep ? !keep.includes(i) : i !== Math.round(placement);
}
}
function setTransforms(pos) {
const width = panelsEl.clientWidth || 1;
placement = pos;
for (const [i, t] of TABS.entries()) {
$('panel-' + t).style.transform = `translateX(${Math.round((i - pos) * width)}px)`;
}
}
function applyPlacement(pos, keep) {
setTransforms(pos);
setVisible(keep);
}

function placeSections(pos, { animate = false, peek = false, keep = null } = {}) {
const mine = (slideToken += 1);
const span = keep || (peek ? sectionRange(Math.floor(pos), Math.ceil(pos)) : null);
if (!animate) {
panelsEl.classList.remove('is-animating');
applyPlacement(pos, span);
return;
}
if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
panelsEl.classList.remove('is-animating');
applyPlacement(pos, null);
return;
}
panelsEl.classList.add('is-animating');
setVisible(span);
void panelsEl.offsetWidth;
applyPlacement(pos, span);
const done = () => {
if (mine !== slideToken) return;
panelsEl.classList.remove('is-animating');
if (span) applyPlacement(pos, null);
};
panelsEl.addEventListener('transitionend', done, { once: true });
setTimeout(done, 400);
}

function selectTab(name, { focus = false, animate = true } = {}) {
const chosen = TABS.includes(name) ? name : TABS[0];
currentTab = chosen;
for (const t of TABS) {
const tab = $('tab-' + t);
const on = t === chosen;
tab.setAttribute('aria-selected', on ? 'true' : 'false');
tab.tabIndex = on ? 0 : -1;
if (on && focus) tab.focus();
}
placeSections(TABS.indexOf(chosen), {
animate,
keep: animate ? sectionRange(Math.round(placement), TABS.indexOf(chosen)) : null,
});
$('panel-' + chosen).scrollTop = 0;
if (chosen !== 'entries' && revealedKeys.size) {
revealedKeys.clear();
secretShownKeys.clear();
rowEpoch += 1;
}
if (chosen !== 'entries' && openKeys.size) {
openKeys.clear();
rowEpoch += 1;
}
placeTips();
if (name === 'settings') syncAppLock();
if (chosen === 'entries' && storeLoaded) pruneExpired();
return chosen;
}

$('tabs').addEventListener('click', (e) => {
const tab = e.target.closest('.tab');
if (tab) selectTab(tab.id.replace(/^tab-/, ''));
});
$('tabs').addEventListener('keydown', (e) => {
const here = TABS.indexOf(String(document.activeElement.id || '').replace(/^tab-/, ''));
if (here < 0) return;
const keys = { ArrowRight: here + 1, ArrowLeft: here - 1, Home: 0, End: TABS.length - 1 };
if (!(e.key in keys)) return;
e.preventDefault();
selectTab(TABS[(keys[e.key] + TABS.length) % TABS.length], { focus: true });
});
selectTab(TABS[0], { animate: false });

const SWIPE_MIN = 36;
const SWIPE_SLOP = 4;
const SWIPE_SLOPE = 1.5;
const SWIPE_SCROLL_MIN = 8;
const SWIPE_FLICK = 18;
const SWIPE_VELOCITY = 0.35;
const SWIPE_MAX_MS = 700;
let swipe = null;
const mainEl = document.querySelector('main');
const trackWidth = () => panelsEl.clientWidth || mainEl.clientWidth || 1;

mainEl.addEventListener(
'touchstart',
(e) => {
swipe = null;
const blocked = e.target.closest('.dd-menu, input:focus:not([type="checkbox"])');
if (e.touches.length !== 1 || blocked) return;
swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: performance.now(), index: TABS.indexOf(currentTab), axis: null };
},
{ passive: true }
);
mainEl.addEventListener(
'touchmove',
(e) => {
if (!swipe || e.touches.length !== 1) return;
const dx = e.touches[0].clientX - swipe.x;
const dy = e.touches[0].clientY - swipe.y;
if (swipe.axis === null) {
if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
const ax = Math.abs(dx);
const ay = Math.abs(dy);
if (ax >= ay) swipe.axis = 'x';
else if (ay >= SWIPE_SCROLL_MIN && ay >= ax * SWIPE_SLOPE) swipe.axis = 'y';
else return;
}
if (swipe.axis !== 'x') return;

const where = Math.max(0, Math.min(TABS.length - 1, swipe.index - dx / trackWidth()));
placeSections(where, { peek: true });
},
{ passive: true }
);
mainEl.addEventListener(
'touchend',
(e) => {
const from = swipe;
swipe = null;
if (!from || from.axis !== 'x') return;
const touch = e.changedTouches[0];
const dx = touch ? touch.clientX - from.x : 0;
const elapsed = Math.max(1, performance.now() - from.at);
const quick = elapsed <= SWIPE_MAX_MS;
const next = from.index + (dx < 0 ? 1 : -1);
const flick = Math.abs(dx) >= SWIPE_FLICK && Math.abs(dx) / elapsed >= SWIPE_VELOCITY;
if (quick && (Math.abs(dx) >= SWIPE_MIN || flick) && next >= 0 && next < TABS.length) selectTab(TABS[next]);
else selectTab(TABS[from.index]);
},
{ passive: true }
);
mainEl.addEventListener(
'touchcancel',
() => {
const from = swipe;
swipe = null;

if (from && from.axis === 'x') {
selectTab(TABS[from.index]);
}
},
{ passive: true }
);
addEventListener('resize', () => { applyHeightTier(); placeSections(placement); placeTips(); });
const fitTabs = window.trovePassFitTabs;
let fitQueued = false;
const queueFitTabs = () => {
if (fitQueued) return;
fitQueued = true;
requestAnimationFrame(() => {
fitQueued = false;
fitTabs();
});
};
addEventListener('resize', queueFitTabs);
queueFitTabs();

const navBar = document.getElementById('tabs');
if (navBar) {
const publishNavHeight = () =>
document.documentElement.style.setProperty('--nav-bar', `${Math.round(navBar.getBoundingClientRect().height)}px`);
publishNavHeight();
if (typeof ResizeObserver === 'function') new ResizeObserver(publishNavHeight).observe(navBar);
}

const RIPPLE_HOST = '.btn, .item, .tab, .dd-opt';
const RIPPLE_SKIP = '.mini, .help, .icon-btn, .chip, .swatch, .check, .out-head .btn';
const RIPPLE_TOUCH_MS = 150;
const RIPPLE_GROW_MS = 450;
const RIPPLE_FADE_IN_MS = 105;
const RIPPLE_FADE_OUT_MS = 375;
const RIPPLE_SLOP = 8;
const RIPPLE_EASE = 'cubic-bezier(.2, 0, 0, 1)';

const RIPPLE_MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (RIPPLE_MOTION) document.documentElement.classList.add('has-ripple');
{
let pending = null;
let live = null;

const paint = (host, x, y) => {
const box = host.getBoundingClientRect();
const longest = Math.max(box.width, box.height);
const radius = Math.hypot(Math.max(x - box.left, box.right - x), Math.max(y - box.top, box.bottom - y)) + 10;
const span = document.createElement('span');
span.className = 'ripple';
span.setAttribute('aria-hidden', 'true');
span.style.width = span.style.height = `${radius * 2}px`;
span.style.left = `${x - box.left - radius}px`;
span.style.top = `${y - box.top - radius}px`;
span.style.setProperty('--ripple-soft', `${Math.max(longest * 0.35, 75)}px`);
host.append(span);
const origin = (longest * 0.2) / (radius * 2);
span.animate([{ transform: `scale(${origin})` }, { transform: 'scale(1)' }],
{ duration: RIPPLE_GROW_MS, easing: RIPPLE_EASE, fill: 'forwards' });
span.animate([{ opacity: 0 }, { opacity: 0.12 }],
{ duration: RIPPLE_FADE_IN_MS, easing: 'linear', fill: 'forwards' });
host.classList.add('is-rippling');
return { span, host };
};

const answerPress = (host, x, y) => (RIPPLE_MOTION ? paint(host, x, y) : null);

const fadeOut = () => {
if (!live) return;
const { span, host } = live;
live = null;
const settled = getComputedStyle(span).opacity;
const done = () => { span.remove(); host.classList.remove('is-rippling'); };
span.animate([{ opacity: settled }, { opacity: 0 }],
{ duration: RIPPLE_FADE_OUT_MS, easing: 'linear', fill: 'forwards' })
.finished.then(done, done);
};

addEventListener('pointerdown', (ev) => {
if (ev.button !== 0 || live || pending) return;
if (ev.target.closest(RIPPLE_SKIP)) return;
const host = ev.target.closest(RIPPLE_HOST);
if (!host || host.disabled || host.getAttribute('aria-disabled') === 'true') return;
const at = { host, x: ev.clientX, y: ev.clientY };
if (ev.pointerType === 'touch') {
pending = { ...at, timer: setTimeout(() => { pending = null; live = answerPress(at.host, at.x, at.y); }, RIPPLE_TOUCH_MS) };
} else {
live = answerPress(at.host, at.x, at.y);
}
}, { passive: true });

addEventListener('pointerup', () => {
if (pending) {
const at = pending;
clearTimeout(at.timer);
pending = null;
live = answerPress(at.host, at.x, at.y);
}
fadeOut();
});
addEventListener('pointercancel', () => {
if (pending) clearTimeout(pending.timer);
pending = null;
fadeOut();
});
addEventListener('pointermove', (ev) => {
if (!pending) return;
if (Math.hypot(ev.clientX - pending.x, ev.clientY - pending.y) > RIPPLE_SLOP) {
clearTimeout(pending.timer);
pending = null;
}
}, { passive: true });
}

const HEIGHT_TIERS = [
[660, 'tier-tight'],
[800, 'tier-compact'],
];
const coarsePointer = matchMedia('(pointer: coarse)');
let tierWidth = 0;
let tierBasis = 0;
function applyHeightTier() {
const h = window.innerHeight;
const w = window.innerWidth;
const keyboard = coarsePointer.matches && w === tierWidth && h < tierBasis;
if (!keyboard) {
tierWidth = w;
tierBasis = h;
}
const root = document.documentElement;
for (const [max, cls] of HEIGHT_TIERS) root.classList.toggle(cls, tierBasis <= max);
}
addEventListener('orientationchange', applyHeightTier);
if (visualViewport) visualViewport.addEventListener('resize', applyHeightTier);
applyHeightTier();

function placeMenu(menu, root, anchorEl) {
const box = anchorEl.getBoundingClientRect();
const below = window.innerHeight - box.bottom - 12;
const above = box.top - 12;
const up = below < 180 && above > below;
menu.classList.toggle('is-up', up);
menu.style.maxHeight = Math.round(Math.max(120, Math.min(320, up ? above : below))) + 'px';
const pad = 8;
const anchor = root.getBoundingClientRect();
const room = window.innerWidth - pad * 2;
menu.style.removeProperty('width');
const natural = menu.offsetWidth;
const width = Math.min(Math.max(anchor.width || box.width, natural), room);
const left = Math.max(pad, Math.min(anchor.left, window.innerWidth - pad - width));
const shift = Math.round(left - anchor.left);
const rtl = getComputedStyle(root).direction === 'rtl';
if (width !== Math.round(anchor.width)) menu.style.width = width + 'px';
else menu.style.removeProperty('width');
menu.style.insetInlineStart = (rtl ? -shift : shift) + 'px';
menu.style.insetInlineEnd = 'auto';
}

const dropdowns = new Map();
let openDropdown = null;
const closeDropdowns = () => {
if (openDropdown) openDropdown.close();
};

function makeCombobox({ prefix, wrapClass = 'dd', className = 'select', value = '', label = null, text = '' }) {
const wrap = document.createElement('div');
wrap.className = wrapClass;
const id = `${prefix}-${(pickSeq += 1)}`;
const btn = document.createElement('button');
btn.id = id;
btn.type = 'button';
btn.className = className;
btn.setAttribute('role', 'combobox');
btn.setAttribute('aria-haspopup', 'listbox');
btn.setAttribute('aria-expanded', 'false');
btn.setAttribute('aria-controls', id + '-menu');
btn.dataset.value = String(value);
if (label != null) btn.setAttribute('aria-label', label);
const valueEl = document.createElement('span');
valueEl.className = 'dd-value';
valueEl.textContent = text;
btn.append(valueEl);
const menu = document.createElement('ul');
menu.id = id + '-menu';
menu.className = 'dd-menu';
menu.setAttribute('role', 'listbox');
menu.hidden = true;
wrap.append(btn, menu);
return { wrap, btn, menu, id, valueEl };
}

function makeDropdown(btn, { onChange, register = true, label = null } = {}) {
const root = btn.closest('.dd');
const valueEl = root.querySelector('.dd-value');
const menu = root.querySelector('.dd-menu');
const options = [...menu.querySelectorAll('[role="option"]')];
options.forEach((o, i) => { o.id = menu.id + '-o' + i; });
let value = btn.dataset.value || '';
let isOpen = false;

const indexOf = (v) => options.findIndex((o) => o.dataset.value === v);
const activeIndex = () => options.findIndex((o) => o.hasAttribute('data-active'));
function paint() {
const at = indexOf(value);
const atValue = options[at];
const selected = atValue === null || atValue === undefined ? (label ? null : options[0]) : atValue;
valueEl.textContent = label ? label(value) : selected ? selected.textContent : '';
btn.dataset.value = label ? value : selected ? selected.dataset.value : '';
for (const o of options) o.setAttribute('aria-selected', String(o === selected));
}
function setActive(at) {
for (let i = 0; i < options.length; i++) {
if (i === at) options[i].setAttribute('data-active', 'true');
else options[i].removeAttribute('data-active');
}
if (at >= 0 && options[at]) btn.setAttribute('aria-activedescendant', options[at].id);
else btn.removeAttribute('aria-activedescendant');
}
const reveal = (at) => {
const atOption = options[at];
if (atOption) atOption.scrollIntoView({ block: 'nearest' });
};
const place = () => placeMenu(menu, root, btn);
function open() {
if (isOpen) return;
closeDropdowns();
isOpen = true;
openDropdown = api;
menu.hidden = false;
btn.setAttribute('aria-expanded', 'true');
place();
setActive(indexOf(value));
reveal(indexOf(value));
}
function close({ focus = false } = {}) {
if (!isOpen) return;
isOpen = false;
if (openDropdown === api) openDropdown = null;
menu.hidden = true;
btn.setAttribute('aria-expanded', 'false');
setActive(-1);
if (focus) btn.focus();
}
function choose(option) {
const next = option ? option.dataset.value : '';
const changed = next !== value;
value = next;
paint();
close({ focus: true });
if (changed && onChange) onChange(value);
}
const api = {
get value() {
return value;
},
set(next, { silent = false } = {}) {
const changed = next !== value;
value = next;
paint();
if (changed && !silent && onChange) onChange(value);
},
options: () => options,
refresh: paint,
open,
close,
};

btn.addEventListener('click', () => (isOpen ? close({ focus: true }) : open()));
btn.addEventListener('keydown', (e) => {
if (!isOpen) {
if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
e.preventDefault();
open();
}
return;
}
if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
e.preventDefault();
const from = activeIndex() >= 0 ? activeIndex() : indexOf(value);
const at = Math.min(options.length - 1, Math.max(0, from + (e.key === 'ArrowDown' ? 1 : -1)));
setActive(at);
reveal(at);
return;
}
if (e.key === 'Home' || e.key === 'End') {
e.preventDefault();
const at = e.key === 'Home' ? 0 : options.length - 1;
setActive(at);
reveal(at);
return;
}
if (e.key === 'Enter' || e.key === ' ') {
e.preventDefault();
choose(options[activeIndex() >= 0 ? activeIndex() : indexOf(value)]);
return;
}
if (e.key === 'Escape') {
e.preventDefault();
close();
return;
}
if (e.key === 'Tab') {
close();
return;
}
if (e.key.length === 1) {
const letter = e.key.toLowerCase();
const from = activeIndex() >= 0 ? activeIndex() : indexOf(value);
for (let i = 1; i <= options.length; i++) {
const at = (from + i + options.length) % options.length;
if (options[at].textContent.trim().toLowerCase().startsWith(letter)) {
setActive(at);
reveal(at);
break;
}
}
}
});
for (const [i, option] of options.entries()) {
option.addEventListener('mouseenter', () => setActive(i));
option.addEventListener('click', () => choose(option));
}
menu.addEventListener('mousedown', (e) => e.preventDefault());

paint();
if (register) dropdowns.set(btn.id, api);
return api;
}

const SUGGEST_LIMIT = 12;
export { SUGGEST_LIMIT };
let openSuggest = null;
const closeSuggests = () => {
if (openSuggest) openSuggest.close();
};

function makeSuggest(input, menu, { other, pick }) {
const partner = pick === 'site' ? 'login' : 'site';
let isOpen = false;
let items = [];
let active = -1;

function build() {
const typed = input.value;
const lower = typed.toLowerCase();
const otherText = other.value;
const seen = new Set();
const ranked = [];
const rows = [...entries].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
for (const entry of rows) {
if (otherText && entry[partner] !== otherText) continue;
const value = entry[pick];
if (!value || value === typed || seen.has(value)) continue;
if (typed && !value.toLowerCase().includes(lower)) continue;
seen.add(value);
ranked.push({ value, prefix: value.toLowerCase().startsWith(lower) ? 0 : 1 });
}
return ranked.sort((a, b) => a.prefix - b.prefix).slice(0, SUGGEST_LIMIT).map((r) => r.value);
}
function paint() {
menu.textContent = '';
items.forEach((value, i) => {
const option = document.createElement('li');
option.className = 'dd-opt';
option.id = `${menu.id}-o${i}`;
option.setAttribute('role', 'option');
option.setAttribute('aria-selected', String(i === active));
option.textContent = value;
option.addEventListener('mouseenter', () => setActive(i));
option.addEventListener('click', () => choose(i));
menu.append(option);
});
}
function setActive(at) {
active = at;
[...menu.children].forEach((option, i) => {
if (i === at) option.setAttribute('data-active', 'true');
else option.removeAttribute('data-active');
});
if (at >= 0 && menu.children[at]) input.setAttribute('aria-activedescendant', menu.children[at].id);
else input.removeAttribute('aria-activedescendant');
const atOption = menu.children[at];
if (atOption) atOption.scrollIntoView({ block: 'nearest' });
}
function close() {
if (!isOpen) return;
isOpen = false;
if (openSuggest === api) openSuggest = null;
menu.hidden = true;
menu.textContent = '';
items = [];
active = -1;
input.setAttribute('aria-expanded', 'false');
input.removeAttribute('aria-activedescendant');
}
function open() {
if (document.activeElement !== input) return close();
items = build();
if (!items.length) return close();
closeDropdowns();
if (openSuggest && openSuggest !== api) openSuggest.close();
isOpen = true;
openSuggest = api;
active = -1;
paint();
menu.hidden = false;
input.setAttribute('aria-expanded', 'true');
placeMenu(menu, menu.closest('.dd'), input);
}
function choose(at) {
const value = items[at];
if (value === undefined) return;
input.value = value;
input.dispatchEvent(new Event('input', { bubbles: true }));
close();
input.focus();
}
const api = { open, close, get items() { return items; } };

input.addEventListener('focus', open);
input.addEventListener('input', open);
input.addEventListener('blur', close);
input.addEventListener('keydown', (e) => {
if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
e.preventDefault();
if (!isOpen) return open();
const at = active < 0
? (e.key === 'ArrowDown' ? 0 : items.length - 1)
: Math.min(items.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1)));
setActive(at);
return;
}
if (!isOpen) return;
if (e.key === 'Home' || e.key === 'End') {
e.preventDefault();
setActive(e.key === 'Home' ? 0 : items.length - 1);
return;
}
if (e.key === 'Enter') {
if (active >= 0) {
e.preventDefault();
choose(active);
}
return;
}
if (e.key === 'Escape') {
e.preventDefault();
close();
return;
}
if (e.key === 'Tab') close();
});
menu.addEventListener('mousedown', (e) => e.preventDefault());
return api;
}


function storage() {
try {
return window.localStorage || null;
} catch (e) {
return null;
}
}

const storageGet = (ls, key) => {
try {
return ls.getItem(key);
} catch (e) {
return null;
}
};

function classes() {
return CLASS_ORDER.filter((k) => $('c-' + k).checked);
}

function derivationInput(i) {
return i;
}

for (const k of CLASS_ORDER) $('pool-' + k).textContent = CHARSETS[k];

function readInputs() {
return {
site: $('site').value,
login: $('login').value,
master: $('master').value,
length: Number($('length').value),
counter: Number($('counter').value),
classes: classes(),
};
}

function numberProblem(i) {
if (!Number.isInteger(i.length) || i.length < MIN_LENGTH || i.length > MAX_LENGTH) {
return t('entries.needLength', { min: MIN_LENGTH, max: MAX_LENGTH });
}
if (!Number.isInteger(i.counter) || i.counter < 1) return t('entries.needCounter');
return '';
}

let fpToken = 0;
let lastFingerprintKey = null;
export const TILE_HUES = [
{ dark: '#ffb000', light: '#996a00' },
{ dark: '#7ddc9a', light: '#1f6b3a' },
{ dark: '#8fb7ff', light: '#1f4fa8' },
{ dark: '#c9a0ff', light: '#5b2fa8' },
{ dark: '#ff9d7a', light: '#9c3d1c' },
{ dark: '#7fe0d6', light: '#0b6a63' },
{ dark: '#ffd479', light: '#7a5a00' },
{ dark: '#e8a0c8', light: '#8c2f63' },
];
const TILE_GRID = 5;
const TILE_MID = TILE_GRID >> 1;
const SVG_NS = 'http://www.w3.org/2000/svg';
const hashBytes = (hash) => Array.from({ length: 32 }, (_, i) => parseInt(hash.slice(i * 2, i * 2 + 2), 16));
function tileSvg(hash, dark) {
const b = hashBytes(hash);
const ink = (n) => TILE_HUES[n % TILE_HUES.length][dark ? 'dark' : 'light'];
const first = ink(b[0]);
const second = ink(b[1] + 1);
const svg = document.createElementNS(SVG_NS, 'svg');
svg.setAttribute('class', 'fp-ico');
svg.setAttribute('viewBox', `0 0 ${TILE_GRID} ${TILE_GRID}`);
svg.setAttribute('aria-hidden', 'true');
for (let y = 0; y < TILE_GRID; y++) {
for (let x = 0; x <= TILE_MID; x++) {
if (!((b[2 + y] >> x) & 1)) continue;
const rect = document.createElementNS(SVG_NS, 'rect');
rect.setAttribute('x', x);
rect.setAttribute('y', y);
rect.setAttribute('width', 1);
rect.setAttribute('height', 1);
rect.setAttribute('fill', x === TILE_MID && (b[9] & 1) === 1 ? second : first);
svg.append(rect);
if (x !== TILE_MID) {
const mirror = rect.cloneNode();
mirror.setAttribute('x', TILE_GRID - 1 - x);
svg.append(mirror);
}
}
}
return svg;
}

function blankFingerprint() {
fingerprintEl.textContent = '';
const cell = document.createElement('span');
cell.className = 'finger is-blank';
cell.setAttribute('aria-hidden', 'true');
fingerprintEl.append(cell);
}

function paintFingers(hash) {
fingerprintEl.textContent = '';
const cell = document.createElement('span');
cell.className = 'finger';
cell.append(tileSvg(hash, isDarkScheme()));
fingerprintEl.append(cell);
}

async function renderFingerprint(master) {
if (master === lastFingerprintKey) return;
lastFingerprintKey = master;
const token = (fpToken += 1);
if (!master) {
blankFingerprint();
return;
}
const { hash } = await fingerprintFor(master);
if (token !== fpToken) return;
paintFingers(hash);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaintFingerprint);

const TOAST_MS = 4500;
export { TOAST_MS };
function toast(el, text, kind = 'ok') {
clearTimeout(el.dataset.timer);
el.classList.remove('warn', 'is-shown');
el.textContent = text || '';
if (!text) return;
el.classList.add('is-shown');
if (kind !== 'ok') {
el.classList.add('warn');
return;
}
el.dataset.timer = setTimeout(() => el.classList.remove('is-shown'), TOAST_MS);
}
const hideToast = (el) => toast(el, '');

let lastOut = '';
let outRevealed = false;

function paintOut() {
const value = lastOut;
const masked = Boolean(value) && !outRevealed;
out.textContent = masked ? t('row.mask') : value;
out.classList.toggle('is-masked', masked);
outRevealBtn.setAttribute('aria-pressed', String(outRevealed));
}

function maskOut() {
outRevealed = false;
paintOut();
}

function setOut(value) {
lastOut = value;
const empty = !value;
if (empty) outSource = '';
outBlockEl.classList.toggle('is-empty', empty);
copyBtn.classList.toggle('hidden', empty);
shareBtn.classList.toggle('hidden', empty);
outRevealBtn.classList.toggle('hidden', empty);
syncGenActions();
paintOut();
if (empty) closeShareQuestion();
}

function syncGenActions() {
const something = Boolean(lastOut) || ['site', 'login', 'master'].some((id) => $(id).value !== '');
genActionsEl.classList.toggle('hidden', !something);
$('save').classList.toggle('hidden', outSource === 'saved');
$('out-saved').classList.toggle('hidden', outSource !== 'saved');
}

function savedEntryFor(site, login) {
if (!site) return null;
const key = site + '\u0000' + login;
const pool = classes().join(',');
const match = entries.find(
(e) =>
entryKey(e) === key &&
(!e.expiresAt || e.expiresAt > Date.now()) &&
e.password &&
e.length === Number($('length').value) &&
e.counter === Number($('counter').value) &&
(e.classes || []).join(',') === pool
);
return match || null;
}

const savedPasswordFor = (site, login) => {
const saved = savedEntryFor(site, login);
return (saved && saved.password) || '';
};

let updateToken = 0;
let outSource = '';
async function update() {
const token = (updateToken += 1);
const i = readInputs();
const match = i.master ? null : savedEntryFor(i.site, i.login);
renderFingerprint(i.master);
if (match) {
errorEl.textContent = '';
outSource = 'saved';
setOut(match.password);
return;
}
if (!i.site || !i.master || !i.classes.length) {
setOut('');
return;
}
const badNumbers = numberProblem(i);
if (badNumbers) {
setOut('');
errorEl.textContent = badNumbers;
return;
}
errorEl.textContent = '';
try {
const value = await generatePassword(derivationInput(i));
if (token === updateToken) {
outSource = 'derived';
setOut(value);
}
} catch (e) {
if (token !== updateToken) return;
setOut('');
errorEl.textContent = e.message;
}
}

function notifyNativeCopy() {
try {
const bridge = window.TrovePassAndroid;
if (bridge && typeof bridge.clipboardCopied === 'function') bridge.clipboardCopied();
} catch (e) {
}
}

async function copyValue(value, line, what) {
if (!value) return false;
errorEl.textContent = '';
try {
await navigator.clipboard.writeText(value);
toast(line, t('status.copiedPlain', { what }));
notifyNativeCopy();
return true;
} catch (e) {
hideToast(line);
errorEl.textContent = t('error.clipboardBlocked');
return false;
}
}


$('clear-clipboard').addEventListener('click', async () => {
errorEl.textContent = '';
let cleared = false;
try {
await navigator.clipboard.writeText('');
cleared = true;
} catch (e) {
}
let nativeClear = false;
try {
const bridge = window.TrovePassAndroid;
if (bridge && typeof bridge.clearClipboard === 'function') {
bridge.clearClipboard();
nativeClear = true;
}
} catch (e) {
}
if (cleared || nativeClear) toast(status, t('status.clipboardCleared'));
else {
errorEl.textContent = t('error.clipboardClear');
}
});

$('gen-options-link').addEventListener('click', () => {
selectTab('settings');
setDisclosed('group-options', 'group-options-body', true);
const group = $('group-options');
group.focus({ preventScroll: true });
group.scrollIntoView({ block: 'start' });
});

const shareBody = (site, login, password) =>
[
[t('site.label'), site],
[t('login.label'), login],
[t('gen.outLabel'), password],
]
.map(([label, value]) => `${label}: ${value || ''}`)
.join('\n');

let shareAsking = false;
function renderShareQuestion() {
$('out-actions').classList.toggle('hidden', shareAsking);
$('out-share-confirm').classList.toggle('hidden', !shareAsking);
$('share-confirm').disabled = !confirmArmed();
}
function askToShare() {
if (!lastOut) return;
shareAsking = true;
armQuestions(renderShareQuestion);
$('share-cancel').focus();
}
function closeShareQuestion() {
if (!shareAsking) return;
shareAsking = false;
renderShareQuestion();
}
shareBtn.addEventListener('click', askToShare);
$('share-cancel').addEventListener('click', () => {
closeShareQuestion();
shareBtn.focus();
});
$('share-confirm').addEventListener('click', () => {
if (!confirmArmed()) return;
const site = $('site').value;
const login = $('login').value;
closeShareQuestion();
shareSecret(site, login, lastOut);
});

async function shareSecret(site, login, password, line = status) {
if (!password) return;
errorEl.textContent = '';
const text = shareBody(site, login, password);
const bridge = window.TrovePassAndroid;
if (bridge && typeof bridge.shareText === 'function') {
bridge.shareText(site || '', text);
return;
}
if (typeof navigator.share === 'function') {
try {
await navigator.share({ title: site || '', text });
} catch (failure) {
}
return;
}
await copyValue(text, line, t('what.share'));
}

const PLAIN_STORE_KEY = 'trovepass.entries.plain';
const PLAIN_STORE_VERSION = 1;
let entries = [];
let folders = [];
const FOLDER_TINTS = ['#f2a8b0', '#f5c79a', '#eee093', '#b6dd9e', '#96ded1', '#a6cdf5', '#bdb9f5', '#e9aee8'];
const TINT_NAMES = ['rose', 'peach', 'butter', 'sage', 'mint', 'sky', 'periwinkle', 'orchid'];
let folderColors = {};
const isTint = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const tintFor = (name) => {
if (isTint(folderColors[name])) return folderColors[name];
let hash = 0;
for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) % 1000003;
return FOLDER_TINTS[hash % FOLDER_TINTS.length];
};
const randomTint = () => {
const used = new Set(folders.map(tintFor));
const free = FOLDER_TINTS.filter((t) => !used.has(t));
const pool = free.length ? free : FOLDER_TINTS;
return pool[Math.floor(Math.random() * pool.length)];
};
const FOLDER_ALL = '\u0000all';
const MAX_FOLDER_LEN = 24;

const isEntry = (e) =>
e &&
typeof e === 'object' &&
typeof e.site === 'string' &&
e.site !== '' &&
typeof e.login === 'string' &&
typeof e.password === 'string';

const folderName = (raw) =>
typeof raw !== 'string'
? ''
: raw
.replace(/[\u0000-\u001f\u007f]/g, '')
.trim()
.slice(0, MAX_FOLDER_LEN);

let storeKey = null;
let unreadableStore = false;

function normalizeStore(raw) {
const clean = (list) =>
(Array.isArray(list) ? list : [])
.filter(isEntry)
.map((e) => {
return {
site: e.site,
login: e.login,
password: e.password,
length: Number.isFinite(Number(e.length)) ? Number(e.length) : null,
counter: Number.isFinite(Number(e.counter)) ? Number(e.counter) : null,
classes: normalizeClasses(e.classes),
folder: folderName(e.folder),
updatedAt: Number.isFinite(Number(e.updatedAt)) ? Number(e.updatedAt) : 0,
expiresAt: Number.isFinite(Number(e.expiresAt)) && Number(e.expiresAt) > 0 ? Number(e.expiresAt) : 0,
expiresMs: Number.isFinite(Number(e.expiresMs)) && Number(e.expiresMs) > 0 ? Number(e.expiresMs) : 0,
expiresManual: e.expiresManual === true,
pinned: e.pinned === true,
};
});
const named = (list) => {
const out = [];
for (const raw of Array.isArray(list) ? list : []) {
const name = folderName(raw);
if (name && !out.some((f) => f.toLowerCase() === name.toLowerCase())) out.push(name);
}
return out;
};
const entries = clean(raw ? raw.entries : undefined);
const folders = named(raw ? raw.folders : undefined);
for (const e of entries) if (e.folder && !folders.includes(e.folder)) folders.push(e.folder);
const colors = {};
const storedColors = raw && raw.folderColors && typeof raw.folderColors === 'object' ? raw.folderColors : {};
for (const [name, value] of Object.entries(storedColors)) {
const folder = folderName(name);
if (folder && isTint(value)) colors[folder] = value.toLowerCase();
}
return { entries, folders, folderColors: colors };
}

const parse = (text) => {
try {
return JSON.parse(text);
} catch (e) {
return null;
}
};

function readPlainStore(ls) {
const plain = parse(storageGet(ls, PLAIN_STORE_KEY) || 'null');
if (plain && plain.v === PLAIN_STORE_VERSION && Array.isArray(plain.entries)) return normalizeStore(plain);
return null;
}

async function loadStore() {
const empty = { entries: [], folders: [], folderColors: {} };
const ls = storage();
if (!ls) return empty;
storeKey = await loadOrCreateKey();

const sealed = parse(storageGet(ls, SEALED_STORE_KEY) || 'null');
if (isEnvelope(sealed)) {
const payload = await openEnvelope(storeKey, sealed);
if (payload) return normalizeStore(payload);
unreadableStore = true;
return empty;
}

const plain = readPlainStore(ls);
if (plain) return plain;
return empty;
}

function dropSupersededPlain(ls) {
try {
const raw = storageGet(ls, PLAIN_STORE_KEY);
if (raw === null) return;
const parsed = parse(raw);
if (!parsed || typeof parsed !== 'object' || parsed.v !== PLAIN_STORE_VERSION) return;
ls.removeItem(PLAIN_STORE_KEY);
} catch (e) {
}
}

async function saveStore({ replaceUnreadable = false } = {}) {
const ls = storage();
if (!ls) return false;
if (!storeLoaded) {
const sealed = parse(storageGet(ls, SEALED_STORE_KEY) || 'null');
if (isEnvelope(sealed)) return false;
const plain = parse(storageGet(ls, PLAIN_STORE_KEY) || 'null');
if (plain && plain.v === PLAIN_STORE_VERSION && Array.isArray(plain.entries)) {
const disk = normalizeStore(plain);
const byKey = new Map(disk.entries.map((e) => [entryKey(e), e]));
for (const entry of entries) byKey.set(entryKey(entry), entry);
entries = [...byKey.values()];
const names = disk.folders.slice();
for (const name of folders) if (!names.some((f) => f.toLowerCase() === name.toLowerCase())) names.push(name);
folders = names;
folderColors = { ...disk.folderColors, ...folderColors };
}
}
if (unreadableStore && !replaceUnreadable) return false;
const payload = { entries, folders, folderColors };
try {
if (storeKey) {
const sealed = await seal(storeKey, payload);
ls.setItem(SEALED_STORE_KEY, JSON.stringify(sealed));
dropSupersededPlain(ls);
return true;
}
ls.setItem(PLAIN_STORE_KEY, JSON.stringify({ v: PLAIN_STORE_VERSION, ...payload }));
return true;
} catch (e) {
return false;
}
}

const entryKey = (e) => e.site + '\u0000' + e.login;
const entryLabel = (e) => (e.login ? e.site + ' · ' + e.login : e.site);

async function commitNow(next, message, nextFolders = folders, { silent = false, colors = folderColors, replaceUnreadable = false } = {}) {
const prev = entries;
const prevFolders = folders;
const prevColors = folderColors;
entries = next;
folders = nextFolders;
folderColors = colors;
const ok = await saveStore({ replaceUnreadable });
if (ok) unreadableStore = false;
if (!ok) {
entries = prev;
folders = prevFolders;
folderColors = prevColors;
}
if (!ok) toast(entriesStatus, unreadableStore ? t('entries.unreadable') : t('entries.storageBlocked'), 'warn');
else if (!silent) toast(entriesStatus, message);
renderEntries();
if (outSource === 'saved') {
const i = readInputs();
if (!savedPasswordFor(i.site, i.login)) setOut('');
}
return ok;
}

let commitTail = Promise.resolve();
function commit(next, message, nextFolders = folders, options = {}) {
const run = commitTail.then(
() => commitNow(next, message, nextFolders, options),
() => commitNow(next, message, nextFolders, options)
);
commitTail = run.catch(() => {});
return run;
}

const FILTER_AFTER = 6;
let entryQuery = '';
let entryFolder = FOLDER_ALL;
let entrySort = 'recent';
let confirmingKey = null;
let confirmingKind = 'delete';
let movingKey = null;
let folderDeleteAsking = false;
let pickSeq = 0;

const matchesQuery = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const SORTS = {
recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
site: (a, b) => collator.compare(a.site, b.site) || collator.compare(a.login, b.login),
login: (a, b) => collator.compare(a.login, b.login) || collator.compare(a.site, b.site),
expiry: (a, b) => {
const x = a.expiresAt || 0;
const y = b.expiresAt || 0;
if (!x && !y) return 0;
if (!x) return 1;
if (!y) return -1;
return x - y;
},
};

const CONFIRM_ARM_MS = 500;
let confirmArmedAt = 0;
const confirmArmed = () => performance.now() >= confirmArmedAt;
let resetAsking = false;
function renderResetRow() {
$('reset-settings').disabled = resetAsking;
$('reset-confirm-row').classList.toggle('hidden', !resetAsking);
$('reset-question').classList.toggle('hidden', !resetAsking);
$('reset-confirm').disabled = !confirmArmed();
}
const armQuestions = (rerender) => {
confirmArmedAt = performance.now() + CONFIRM_ARM_MS;
rerender();
setTimeout(() => {
if (!confirmArmed()) return;
rerender();
}, CONFIRM_ARM_MS + 30);
};
const askToConfirm = (key, kind = 'delete') => {
confirmingKey = key;
confirmingKind = kind;
movingKey = null;
armQuestions(renderEntries);
};

let shownKeys = new Set();
const ENTER_ANIMATION_ROWS = 24;
let enterBudget = ENTER_ANIMATION_ROWS;

function syncFilter(inputEl, count, query) {
inputEl.parentElement.classList.toggle('hidden', !(count >= FILTER_AFTER || query !== ''));
if (inputEl.value !== query) inputEl.value = query;
}

$('entries-filter').addEventListener('input', (e) => {
entryQuery = e.target.value;
renderEntries();
});


const ICON_CLASS = { 'i-copy': 'ico-copy', 'i-move': 'ico-move', 'i-share': 'ico-share', 'i-trash': 'ico-trash', 'i-plus': 'ico-plus',
'i-eye': 'ico-eye', 'i-eye-off': 'ico-eye-off', 'i-star': 'ico-star', 'i-star-fill': 'ico-star-fill' };

function copyCell(value, node, what) {
const b = document.createElement('button');
b.type = 'button';
b.className = 'copy-cell';
b.setAttribute('aria-label', `${t('action.copy')} ${value}`);
b.title = t('action.copy');
b.append(node);
b.addEventListener('click', () => copyValue(value, entriesStatus, what));
return b;
}

function actionButton({ id, cls, text, aria, title, onClick, disabled = false, icon = null, pressed = null }) {
const b = document.createElement('button');
b.type = 'button';
if (id) b.id = id;
b.className = cls;
if (pressed !== null) b.setAttribute('aria-pressed', String(pressed));
if (aria) b.setAttribute('aria-label', aria);
b.title = title || aria || '';
if (icon) {
b.classList.add('ico-only');
const mark = document.createElement('span');
mark.className = 'ico' + (ICON_CLASS[icon] ? ' ' + ICON_CLASS[icon] : '');
mark.setAttribute('aria-hidden', 'true');
b.append(mark);
}
if (text) b.append(document.createTextNode(text));
b.disabled = disabled;
b.addEventListener('click', onClick);
return b;
}

const folderNewOpen = () => !$('folder-new').classList.contains('hidden');
function setFolderNew(open) {
$('folder-new').classList.toggle('hidden', !open);
if (!open) $('folder-name').value = '';
const addChip = $('folders').querySelector('.chip[data-kind="add"]');
if (addChip) addChip.setAttribute('aria-expanded', String(open));
if (open) $('folder-name').focus();
else if (document.activeElement === $('folder-name') && addChip) addChip.focus();
}

function moveEntry(key, folder) {
const at = entries.findIndex((e) => entryKey(e) === key);
movingKey = null;
if (at === -1) return;
const dest = folderName(folder);
if ((entries[at].folder || '') === dest) {
renderEntries();
return;
}
const next = entries.slice();
next[at] = { ...next[at], folder: dest };
const who = entryLabel(entries[at]);
return commit(next, dest ? t('folder.moved', { folder: dest, who }) : t('entries.updated', { who }));
}

function togglePinned(key) {
const at = entries.findIndex((e) => entryKey(e) === key);
if (at === -1) return Promise.resolve(false);
const next = entries.slice();
next[at] = { ...next[at], pinned: !next[at].pinned };
return commit(next, '', folders, { silent: true });
}

async function addFolder(raw) {
const name = folderName(raw);
if (!name) {
toast(entriesStatus, t('folder.nameNeeded'), 'warn');
return false;
}
const same = folders.find((f) => f.toLowerCase() === name.toLowerCase());
if (same) {
hideToast(entriesStatus);
entryFolder = same;
renderEntries();
return true;
}
return commit(entries, t('folder.created', { name }), folders.concat(name), {
colors: { ...folderColors, [name]: randomTint() },
});
}

function deleteFolder(name) {
if (!folders.includes(name)) return;
const kept = entries.map((e) => ((e.folder || '') === name ? { ...e, folder: '' } : e));
entryFolder = FOLDER_ALL;
folderDeleteAsking = false;
movingKey = null;
const colors = { ...folderColors };
delete colors[name];
return commit(kept, t('folder.deleted', { name }), folders.filter((f) => f !== name), { colors });
}

function clearEverything() {
entryFolder = FOLDER_ALL;
folderDeleteAsking = false;
movingKey = null;
return commit([], t('entries.cleared'), [], { colors: {}, replaceUnreadable: true });
}

function setFolderColor(name, color) {
if (!folders.includes(name) || !isTint(color) || tintFor(name) === color.toLowerCase()) return Promise.resolve(false);
return commit(entries, '', folders, { silent: true, colors: { ...folderColors, [name]: color.toLowerCase() } });
}


function setDisclosed(btnId, bodyId, open) {
const btn = $(btnId);
if (btn) btn.setAttribute('aria-expanded', String(open));
$(bodyId).classList.toggle('hidden', !open);
if (open) placeTips();
}
for (const [btnId, bodyId] of [
['data-toggle', 'data-body'],
['folder-options', 'folder-options-body'],
['group-appearance', 'group-appearance-body'],
['group-privacy', 'group-privacy-body'],
['group-options', 'group-options-body'],
]) {
const btn = $(btnId);
btn.addEventListener('click', () =>
setDisclosed(btnId, bodyId, btn.getAttribute('aria-expanded') !== 'true')
);
}

function renderFolders() {
const box = $('folders');
box.textContent = '';
const chip = (kind, label, value) => {
const b =
kind === 'add'
? actionButton({
cls: 'chip add',
icon: 'i-plus',
aria: label,
title: label,
onClick: () => setFolderNew(true),
})
: actionButton({
cls: 'chip',
text: label,
onClick: () => {
folderDeleteAsking = false;
entryFolder = value;
renderEntries();
},
});
b.dataset.kind = kind;
if (kind === 'named') {
b.dataset.name = value;
b.style.setProperty('--tint', tintFor(value));
}
if (kind === 'add') b.setAttribute('aria-expanded', String(folderNewOpen()));
else b.setAttribute('aria-pressed', String(entryFolder === value));
if (kind !== 'all') {
b.addEventListener('dragover', (e) => {
e.preventDefault();
if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
b.classList.add('is-drop');
});
b.addEventListener('dragleave', () => b.classList.remove('is-drop'));
b.addEventListener('drop', (e) => {
e.preventDefault();
b.classList.remove('is-drop');
const key = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
if (key) moveEntry(key, value);
});
}
box.append(b);
return b;
};
chip('all', t('folder.all'), FOLDER_ALL);
for (const name of folders) chip('named', name, name);
chip('add', t('folder.new'), '');
const actions = $('folder-actions');
actions.textContent = '';
const own = folders.includes(entryFolder);
$('folder-options-wrap').classList.toggle('hidden', !own);
if (!own) {
folderDeleteAsking = false;
setDisclosed('folder-options', 'folder-options-body', false);
}
if (own) {
actions.append(
actionButton({
id: 'folder-delete',
cls: 'mini danger',
text: t('folder.delete'),
aria: t('folder.deleteAria', { name: entryFolder }),
disabled: folderDeleteAsking,
onClick: () => askFolderDelete(),
})
);
const swatches = document.createElement('span');
swatches.className = 'swatches';
swatches.setAttribute('role', 'group');
swatches.setAttribute('aria-label', entryFolder);
for (const [i, tint] of FOLDER_TINTS.entries()) {
const b = actionButton({
cls: 'swatch',
title: TINT_NAMES[i],
aria: `${TINT_NAMES[i]} — ${entryFolder}`,
pressed: tintFor(entryFolder) === tint,
onClick: () => setFolderColor(entryFolder, tint),
});
b.style.setProperty('--tint', tint);
b.dataset.tint = tint;
swatches.append(b);
}
actions.append(swatches);
}
renderFolderConfirm();
}

function askFolderDelete() {
folderDeleteAsking = true;
armQuestions(renderEntries);
$('folder-delete-cancel').focus();
}

function renderFolderConfirm() {
const asking = folderDeleteAsking && folders.includes(entryFolder);
$('folder-confirm-row').classList.toggle('hidden', !asking);
$('folder-confirm').classList.toggle('hidden', !asking);
$('folder-delete-confirm').disabled = !confirmArmed();
}

function digest(text) {
let h = 5381;
for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
return h.toString(36);
}

const rowSignature = (e, key) => {
const state =
confirmingKey === key
? 'c' + (confirmArmed() ? '1' : '0')
: movingKey === key
? 'm' + folders.join('\u001f')
: '-';
return [rowEpoch, e.site, e.login, e.password ? digest(e.password) : '', e.folder || '', folders.length ? 1 : 0, tintFor(e.folder), e.expiresAt || 0, e.expiresManual ? 1 : 0, e.pinned ? 1 : 0, revealedKeys.has(key) ? 1 : 0, secretShownKeys.has(key) ? 1 : 0, openKeys.has(key) ? 1 : 0, state].join('\u0000');
};

function entryRow(e, wasShown) {
const key = entryKey(e);
const revealed = revealedKeys.has(key);
const row = document.createElement('div');
row.className = 'item';
row.setAttribute('role', 'listitem');
const meta = document.createElement('span');
meta.className = 'meta';
const title = document.createElement('span');
title.className = 'title';
const site = document.createElement('span');
site.className = 'site';
site.textContent = e.site;
site.dir = 'auto';
if (e.pinned) {
const star = document.createElement('span');
star.className = 'ico ico-star-fill pin-mark';
star.setAttribute('aria-hidden', 'true');
title.append(star);
}
title.append(revealed ? copyCell(e.site, site, t('site.label')) : site);
if (e.folder) {
const tag = document.createElement('span');
tag.className = 'tag';
tag.textContent = e.folder;
tag.dir = 'auto';
tag.style.setProperty('--tint', tintFor(e.folder));
title.append(tag);
}
const hint = document.createElement('span');
hint.className = 'hint';
const who = document.createElement('span');
who.className = 'who';
who.textContent = e.login;
who.dir = 'auto';
if (revealed) {
if (e.login) hint.append(copyCell(e.login, who, t('login.label')));
else hint.hidden = true;
} else if (e.login) {
hint.append(who);
} else {
hint.hidden = true;
}
const label = entryLabel(e);
const secret = document.createElement('div');
secret.className = 'secret';
if (revealed && e.password) {
const shown = secretShownKeys.has(key);
const value = document.createElement('button');
value.type = 'button';
value.className = 'secret-value';
value.setAttribute('aria-label', t('row.copyAria', { who: label }));
value.addEventListener('click', async () => {
if (await copyValue(e.password, entriesStatus, t('gen.outLabel'))) renewEntry(key);
});
value.textContent = shown ? e.password : t('row.mask');
value.classList.toggle('is-masked', !shown);
secret.append(value);
secret.append(
actionButton({
cls: 'secret-eye',
icon: shown ? 'i-eye' : 'i-eye-off',
title: t('gen.toggle'),
aria: `${t('gen.toggle')} — ${label}`,
pressed: shown,
onClick: () => {
if (shown) secretShownKeys.delete(key);
else secretShownKeys.add(key);
renderEntries();
},
})
);
}
if (revealed) row.classList.add('revealed');
if (openKeys.has(key)) row.classList.add('is-open');

const lines = document.createElement('span');
lines.className = 'lines';
lines.append(title, hint);
const rowActions = document.createElement('span');
rowActions.className = 'row-actions';
meta.append(rowActions);
if (!revealed) meta.prepend(lines);
const actions = document.createElement('span');
actions.className = 'actions';
const controlsId = 'row-controls-' + (pickSeq += 1);

const ttlCell = document.createElement('span');
ttlCell.className = 'exp';
{
const name = `${t('ttl.edit')} — ${label}` + (e.expiresManual ? ` (${t('ttl.manual')})` : '');
const { wrap, btn, menu } = makeCombobox({
prefix: 'ttl',
wrapClass: 'dd ttl',
className: 'chip ttl' + (e.expiresManual ? ' is-manual' : ''),
value: e.expiresAt || 0,
label: name,
text: ttlLabel(e.expiresAt),
});
btn.title = name;
btn.dataset.expires = String(e.expiresAt || 0);
let dropdown = null;
const build = () => {
if (dropdown) return dropdown;
for (const ms of ttlChoices()) {
const li = document.createElement('li');
li.className = 'dd-opt';
li.setAttribute('role', 'option');
li.dataset.value = String(ms);
li.textContent = ms ? durationText(ms) : t('settings.clearNever');
menu.append(li);
}
dropdown = makeDropdown(btn, {
register: false,
label: ttlLabel,
onChange: (next) => setEntryExpiry(key, Number(next)),
});
return dropdown;
};
btn.addEventListener('click', () => {
const fresh = !dropdown;
build();
if (fresh) dropdown.open();
});
btn.addEventListener('keydown', (e) => {
if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
if (dropdown) return;
e.preventDefault();
build().open();
});
ttlCell.append(wrap);
}

if (confirmingKey === key) {
row.classList.add('confirming');
const act =
confirmingKind === 'share'
? ['share', 'action.share', () => { if (confirmArmed()) { confirmingKey = null; renderEntries(); shareSecret(e.site, e.login, e.password, entriesStatus); } }]
: ['delete', 'action.delete', () => { if (confirmArmed()) commit(entries.filter((x) => entryKey(x) !== key), t('entries.deleted', { who: label })); }];
for (const [cls, textKey, fn] of [
['cancel', 'action.cancel', () => { confirmingKey = null; renderEntries(); }],
act,
]) {
actions.append(
actionButton({
cls: 'mini ' + cls,
text: t(textKey),
aria: `${t(textKey)} — ${label}`,
onClick: fn,
disabled: cls !== 'cancel' && !confirmArmed(),
})
);
}
} else if (movingKey === key) {
row.classList.add('moving');
actions.append(
actionButton({
cls: 'mini cancel',
text: t('action.cancel'),
aria: `${t('action.cancel')} — ${label}`,
onClick: () => { movingKey = null; renderEntries(); },
})
);
} else {
actions.append(
actionButton({
cls: 'mini pin',
icon: e.pinned ? 'i-star-fill' : 'i-star',
pressed: e.pinned === true,
title: t('row.pin'),
aria: `${t('row.pin')} — ${label}`,
onClick: () => togglePinned(key),
})
);
if (e.password) {
const shown = revealedKeys.has(key);
rowActions.append(
actionButton({
cls: 'mini reveal',
icon: shown ? 'i-eye' : 'i-eye-off',
title: t('gen.toggle'),
aria: `${t('gen.toggle')} — ${label}`,
pressed: shown,
onClick: () => {
if (shown) {
revealedKeys.delete(key);
secretShownKeys.delete(key);
} else {
revealedKeys.add(key);
}
renderEntries();
},
})
);
rowActions.append(
actionButton({
cls: 'mini copy',
icon: 'i-copy',
title: t('action.copy'),
aria: t('row.copyAria', { who: label }),
onClick: async () => {
if (await copyValue(e.password, entriesStatus, t('gen.outLabel'))) renewEntry(key);
},
})
);
actions.append(
actionButton({
cls: 'mini share',
icon: 'i-share',
title: t('action.share'),
aria: `${t('action.share')} — ${label}`,
onClick: () => {
askToConfirm(key, 'share');
const cancelButton = $('entries').querySelector('.item.confirming .mini.cancel');
if (cancelButton) cancelButton.focus();
},
})
);
}
if (folders.length) {
actions.append(
actionButton({
cls: 'mini move',
icon: 'i-move',
title: t('folder.move'),
aria: t('folder.moveAria', { who: label }),
onClick: () => {
movingKey = key;
confirmingKey = null;
renderEntries();
const selectButton = $('entries').querySelector('.item.moving .dd .select');
if (selectButton) selectButton.focus();
},
})
);
}
actions.append(
actionButton({
cls: 'mini delete',
icon: 'i-trash',
title: t('action.delete'),
aria: t('entries.deleteAria', { who: label }),
onClick: () => {
askToConfirm(key);
const cancelButton = $('entries').querySelector('.item.confirming .mini.cancel');
if (cancelButton) cancelButton.focus();
},
})
);
const isOpen = openKeys.has(key);
const more = document.createElement('button');
more.type = 'button';
more.className = 'mini more';
more.setAttribute('aria-expanded', String(isOpen));
more.setAttribute('aria-controls', controlsId);
more.setAttribute('aria-label', `${t('row.more')} — ${label}`);
more.title = t('row.more');
const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
chevron.setAttribute('class', 'ico chev');
chevron.setAttribute('aria-hidden', 'true');
const href = document.createElementNS('http://www.w3.org/2000/svg', 'use');
href.setAttribute('href', '#i-chevron');
chevron.append(href);
more.append(chevron);
more.addEventListener('click', () => {
if (isOpen) openKeys.delete(key);
else openKeys.add(key);
renderEntries();
});
rowActions.append(more);
}
const controls = document.createElement('div');
controls.className = 'controls';
controls.id = controlsId;
controls.append(ttlCell, actions);
if (e.password && revealed) row.append(meta, lines, secret, controls);
else row.append(meta, controls);
if (movingKey === key) {
const { wrap, btn: pickBtn, menu: pickMenu } = makeCombobox({
prefix: 'pick',
value: e.folder || '',
label: t('folder.moveAria', { who: label }),
});
for (const [value, name] of [['', t('folder.noFolder')], ...folders.map((f) => [f, f])]) {
const li = document.createElement('li');
li.className = 'dd-opt';
li.setAttribute('role', 'option');
li.dataset.value = value;
li.textContent = name;
pickMenu.append(li);
}
makeDropdown(pickBtn, { onChange: (next) => moveEntry(key, next), register: false });
controls.append(wrap);
}
if (folders.length) {
row.draggable = true;
row.addEventListener('dragstart', (ev) => {
if (!ev.dataTransfer) return;
ev.dataTransfer.setData('text/plain', key);
ev.dataTransfer.effectAllowed = 'move';
row.classList.add('is-dragging');
});
row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
}
if (!wasShown.has(key) && enterBudget > 0) {
enterBudget--;
row.classList.add('enter');
}
return row;
}

function renderEntries() {
const q = entryQuery.trim().toLowerCase();
const wasShown = shownKeys;
enterBudget = ENTER_ANIMATION_ROWS;
const order = SORTS[entrySort] || SORTS.recent;
const shown = entries
.filter((e) => entryFolder === FOLDER_ALL || (e.folder || '') === entryFolder)
.filter((e) => matchesQuery(q, e.site, e.login, e.folder))
.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || order(a, b));
shownKeys = new Set(shown.map(entryKey));
renderFolders();
$('entries-tools').classList.toggle('hidden', entries.length === 0);
syncFilter($('entries-filter'), entries.length, entryQuery);
const existing = new Map();
for (const row of entriesEl.children) existing.set(row.dataset.key, row);
const wanted = new Set(shown.map(entryKey));
for (const [key, row] of existing) if (!wanted.has(key)) row.remove();
const ordered = shown.map((e) => {
const key = entryKey(e);
const signature = rowSignature(e, key);
const row = existing.get(key);
if (row && row.dataset.signature === signature) return row;
const fresh = entryRow(e, wasShown);
fresh.dataset.key = key;
fresh.dataset.signature = signature;
if (row) row.replaceWith(fresh);
return fresh;
});
const inPlace = ordered.length === entriesEl.children.length && ordered.every((el, i) => entriesEl.children[i] === el);
if (!inPlace) {
const fragment = document.createDocumentFragment();
fragment.append(...ordered);
entriesEl.append(fragment);
}
$('entries-unreadable').classList.toggle('hidden', !unreadableStore);
entriesEmptyEl.classList.toggle('hidden', !storeLoaded || entries.length > 0 || unreadableStore);
const hiding = entryQuery.trim() || (entryFolder === FOLDER_ALL ? '' : entryFolder);
entriesNoMatchEl.textContent = entries.length && !shown.length ? t('list.noMatch', { q: hiding }) : '';
entriesNoMatchEl.classList.toggle('hidden', !entriesNoMatchEl.textContent);
const askingAll = confirmingKey === 'all';
$('clear-entries').disabled = (entries.length === 0 && !unreadableStore) || askingAll;
$('entries-confirm-row').classList.toggle('hidden', !askingAll);
$('clear-confirm').disabled = !confirmArmed();
$('entries-confirm').classList.toggle('hidden', !askingAll);
}

function saveCurrent() {
errorEl.textContent = '';
hideToast(entriesStatus);
hideToast(status);
const i = readInputs();
const numbers = numberProblem(i);
let problem = '';
if (!i.site) problem = t('entries.needSite');
else if (!i.classes.length) problem = t('entries.needClass');
else if (numbers) problem = numbers;
else if (!i.master) problem = t('entries.needMaster');
if (problem) {
errorEl.textContent = problem;
return;
}
return (async () => {
let password = '';
try {
password = await generatePassword(derivationInput(i));
} catch (e) {
errorEl.textContent = e.message;
return;
}
const entry = { site: i.site, login: i.login, password, length: i.length, counter: i.counter, classes: i.classes };
const at = entries.findIndex((e) => entryKey(e) === entryKey(entry));
entry.folder = at === -1 ? '' : entries[at].folder || '';
entry.updatedAt = Date.now();
entry.expiresAt = at === -1 ? (entryTtlMs ? Date.now() + entryTtlMs : 0) : entries[at].expiresAt || 0;
entry.expiresMs = at === -1 ? 0 : Number(entries[at].expiresMs) || 0;
entry.expiresManual = at !== -1 && entries[at].expiresManual === true;
entry.pinned = at !== -1 && entries[at].pinned === true;
const next = entries.slice();
if (at === -1) next.push(entry);
else next[at] = entry;
const message = t(at === -1 ? 'entries.saved' : 'entries.updated', { who: entryLabel(entry) });
await commit(next, message);
})();
}

export const CLEAR_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_LENGTH = 16;
const DEFAULT_COUNTER = 1;

let clearAfterMs = CLEAR_AFTER_MS;
let paused = false;
let wipeOnHide = false;
const DEFAULT_ENTRY_TTL_MS = 0;
let entryTtlMs = DEFAULT_ENTRY_TTL_MS;
let renewOnCopy = true;

function readSettings() {
const ls = storage();
if (!ls) return {};
try {
const raw = JSON.parse(ls.getItem(SETTINGS_STORE_KEY) || 'null');
return raw && typeof raw === 'object' ? raw : {};
} catch (e) {
return {};
}
}

function writeSettings(patch) {
const ls = storage();
if (!ls) return false;
try {
ls.setItem(SETTINGS_STORE_KEY, JSON.stringify(Object.assign(readSettings(), patch)));
return true;
} catch (e) {
return false;
}
}

function storeInputs() {
writeSettings({ length: Number($('length').value), counter: Number($('counter').value), classes: classes() });
}

function applyStoredInputs(s) {
if (Number.isFinite(s.length)) $('length').value = String(s.length);
if (Number.isFinite(s.counter)) $('counter').value = String(s.counter);
if (Array.isArray(s.classes)) {
const chosen = s.classes.filter((k) => CLASS_ORDER.includes(k));
for (const k of CLASS_ORDER) $('c-' + k).checked = chosen.length ? chosen.includes(k) : true;
}
}

function clearEntered() {
updateToken += 1;
const hadSomething = ['site', 'login', 'master'].some((id) => $(id).value !== '') || Boolean(lastOut);
for (const id of ['site', 'login', 'master']) $(id).value = '';
closeSuggests();
setRevealed(false);
maskOut();
setOut('');
renderFingerprint('');
if (hadSomething) toast(status, t('settings.cleared'));
armClearFields();
}

let clearFieldsTimer = null;
let clearArmedAt = 0;
const pad2 = (n) => String(n).padStart(2, '0');
function countdownText(ms) {
const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
const h = Math.floor(total / 3600);
const m = Math.floor((total % 3600) / 60);
const s = total % 60;
return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
function remainingText(ms) {
const left = Math.max(0, Number(ms) || 0);
if (left > 600000) {
const mins = Math.round(left / 60000);
const d = Math.floor(mins / 1440);
const h = Math.floor((mins % 1440) / 60);
const m = mins % 60;
if (d) return h ? `${d}d ${h}h` : `${d}d`;
if (h) return m ? `${h}h ${m}m` : `${h}h`;
return `${m}m`;
}
return countdownText(left);
}
function paintCountdown() {
clearPauseBtn.classList.toggle('hidden', !clearAfterMs);
clearPauseBtn.setAttribute('aria-pressed', String(paused));
const armed = Boolean(clearArmedAt) && !paused && clearAfterMs > 0;
clearLeftEl.textContent = armed ? countdownText(clearArmedAt + clearAfterMs - Date.now()) : '';
}
function armClearFields() {
clearTimeout(clearFieldsTimer);
clearArmedAt = 0;
if (clearAfterMs && !paused) {
clearArmedAt = Date.now();
clearFieldsTimer = setTimeout(clearEntered, clearAfterMs);
}
paintCountdown();
}
clearPauseBtn.addEventListener('click', () => {
paused = !paused;
writeSettings({ paused });
armClearFields();
});
setInterval(() => {
if (document.hidden) return;
paintCountdown();
if (currentTab === 'entries') tickExpiry();
}, 1000);

function applyLocale(chosen) {
const next = setLocale(chosen);
dropdowns.get('locale').set(next, { silent: true });
applyDom();
renderTimerOptions();
for (const d of dropdowns.values()) d.refresh();
queueFitTabs();
rowEpoch += 1;
renderEntries();
update();
}

function renderTimerOptions() {
for (const option of dropdowns.get('clear-after').options()) {
const ms = Number(option.dataset.value);
option.textContent = ms ? t('settings.clearAfter', { n: ms / 60000 }) : t('settings.clearNever');
}
for (const option of dropdowns.get('lock-idle').options()) {
const ms = Number(option.dataset.value);
option.textContent = ms ? t('settings.clearAfter', { n: ms / 60000 }) : t('settings.clearNever');
}
for (const option of dropdowns.get('entry-ttl').options()) {
const ms = Number(option.dataset.value);
option.textContent = ms ? durationText(ms) : t('settings.clearNever');
}
}

const SCHEMES = ['system', 'light', 'dark'];
let scheme = 'system';
const schemeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
const schemeMetaDefaults = schemeMetas.map((m) => m.getAttribute('content'));
const isDarkScheme = () =>
scheme === 'dark' || (scheme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);

function repaintFingerprint() {
const master = $('master').value;
lastFingerprintKey = null;
renderFingerprint(master);
}

function syncSchemeChrome() {
const forced = scheme === 'system';
const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
schemeMetas.forEach((meta, i) => meta.setAttribute('content', forced ? schemeMetaDefaults[i] : bg || schemeMetaDefaults[i]));
}

function notifyNativeScheme() {
try {
const bridge = window.TrovePassAndroid;
if (bridge && typeof bridge.schemeChanged === 'function') bridge.schemeChanged(isDarkScheme());
} catch (e) {
}
}

function applyScheme(next, { persist = true } = {}) {
scheme = SCHEMES.includes(next) ? next : 'system';
const root = document.documentElement;
if (scheme === 'system') root.removeAttribute('data-scheme');
else root.setAttribute('data-scheme', scheme);
const schemeControl = dropdowns.get('scheme');
if (schemeControl) schemeControl.set(scheme, { silent: true });
syncSchemeChrome();
repaintFingerprint();
notifyNativeScheme();
if (persist) writeSettings({ scheme });
}

makeDropdown($('scheme'), { onChange: applyScheme });
makeDropdown($('locale'), { onChange: applyLocale });
makeDropdown($('clear-after'), {
onChange: (next) => {
clearAfterMs = Number(next) || 0;
writeSettings({ clearAfterMs });
armClearFields();
},
});
makeDropdown($('entries-sort'), {
onChange: (next) => {
entrySort = SORTS[next] ? next : 'recent';
renderEntries();
},
});
makeDropdown($('entry-ttl'), {
onChange: (next) => {
entryTtlMs = Number(next) || 0;
writeSettings({ entryTtlMs });
pruneExpired();
},
});

const DURATION_STEPS = [
[60, 'hour'],
[24, 'day'],
[365, 'year'],
];
const durationFormats = new Map();
function durationText(ms) {
const unitText = (n, unit) => {
const locale = document.documentElement.lang || 'en';
const key = locale + '\u001f' + unit;
if (!durationFormats.has(key)) {
try {
durationFormats.set(
key,
new Intl.NumberFormat(locale, {
style: 'unit',
unit,
unitDisplay: 'narrow',
useGrouping: false,
})
);
} catch (e) {
durationFormats.set(key, null);
}
}
const format = durationFormats.get(key);
return format ? format.format(n) : `${n}${unit[0]}`;
};
let value = Math.max(0, Number(ms) || 0) / 60000;
let unit = 'minute';
for (const [divisor, next] of DURATION_STEPS) {
if (value < divisor) break;
value /= divisor;
unit = next;
}
return unitText(Math.max(1, Math.round(value)), unit);
}

const ttlLabel = (value) => {
const v = Number(value) || 0;
if (!v) return t('ttl.set');
return remainingText(v > 1e12 ? v - Date.now() : v);
};

function tickExpiry() {
let expired = false;
for (const btn of entriesEl.querySelectorAll('.chip.ttl')) {
const at = Number(btn.dataset.expires) || 0;
if (!at) continue;
const left = at - Date.now();
if (left <= 0) {
expired = true;
continue;
}
const shown = btn.querySelector('.dd-value');
if (shown) shown.textContent = remainingText(left);
}
if (expired) pruneExpired();
}

const ttlChoices = () => dropdowns.get('entry-ttl').options().map((o) => Number(o.dataset.value));

async function setEntryExpiry(key, ms) {
const at = entries.findIndex((e) => entryKey(e) === key);
if (at === -1) return;
const next = entries.slice();
next[at] = { ...next[at], expiresAt: ms ? Date.now() + ms : 0, expiresMs: ms || 0, expiresManual: true };
await commit(next, t('entries.updated', { who: entryLabel(next[at]) }));
}

async function renewEntry(key) {
if (!renewOnCopy) return;
const at = entries.findIndex((e) => entryKey(e) === key);
if (at === -1) return;
const term = entries[at].expiresManual ? Number(entries[at].expiresMs) || 0 : entryTtlMs;
if (!term) return;
const next = entries.slice();
next[at] = { ...next[at], expiresAt: Date.now() + term };
await commit(next, '', folders, { silent: true });
}

async function pruneExpired() {
if (!entries.length || !storeLoaded) return;
const now = Date.now();
const stale = entries.filter((e) => Number(e.expiresAt) > 0 && Number(e.expiresAt) <= now);
if (!stale.length) return;
const gone = new Set(stale);
await commit(entries.filter((e) => !gone.has(e)), tn('settings.pruned', stale.length));
}

const backupPasswordEl = $('backup-password');
const backupFileEl = $('backup-file');

function backupFileName() {
const day = new Date().toISOString().slice(0, 10);
return `${BRAND.slug}-backup-${day}.txt`;
}

function saveBackupFile(name, text) {
const bridge = window.TrovePassAndroid;
if (bridge && typeof bridge.saveFile === 'function') {
bridge.saveFile(name, text);
return false;
}
const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
const link = document.createElement('a');
link.href = url;
link.download = name;
document.body.append(link);
link.click();
link.remove();
setTimeout(() => URL.revokeObjectURL(url), 10000);
return true;
}

const BACKUP_FALLBACK_PASSWORD = 'TrovePass-backup-v1-dRCV82hyvZneMrgn54w7AuAaTJyQZiQFBEHuimfePkyD';
const backupPassword = () => backupPasswordEl.value || BACKUP_FALLBACK_PASSWORD;

async function exportBackup() {
errorEl.textContent = '';
const line = await sealBackup(backupPassword(), { entries, folders, exportedAt: new Date().toISOString() });
const browserDownload = saveBackupFile(backupFileName(), line);
if (browserDownload) toast(status, tn('backup.exported', entries.length));
else backupExportPending = entries.length;
}

let backupExportPending = 0;

$('backup-share').addEventListener('click', async () => {
errorEl.textContent = '';
const bridge = window.TrovePassAndroid;
const native = bridge && typeof bridge.shareText === 'function';
if (!native && typeof navigator.share !== 'function') {
exportBackup();
return;
}
const line = await sealBackup(backupPassword(), { entries, folders, exportedAt: new Date().toISOString() });
if (native) {
bridge.shareText(backupFileName(), line);
return;
}
try {
await navigator.share({ title: backupFileName(), text: line });
} catch (failure) {
}
});

const readBackupOutcome = () => {
if (!backupExportPending || document.visibilityState === 'hidden') return;
const bridge = window.TrovePassAndroid;
if (!bridge || typeof bridge.lastBackupResult !== 'function') {
backupExportPending = 0;
return;
}
let outcome = 'none';
try {
outcome = String(bridge.lastBackupResult() || 'none');
} catch (e) {
outcome = 'none';
}
if (outcome === 'none') return;
const count = backupExportPending;
backupExportPending = 0;
if (outcome === 'ok') toast(status, tn('backup.exported', count));
};
document.addEventListener('visibilitychange', readBackupOutcome);
window.addEventListener('focus', readBackupOutcome);

function readShellEntry() {
const bridge = window.TrovePassAndroid;
if (!bridge) return;
try {
if (typeof bridge.takePendingTab === 'function') {
const tab = bridge.takePendingTab();
if (TABS.includes(tab)) selectTab(tab);
}
if (typeof bridge.takePendingText === 'function') {
const text = bridge.takePendingText();
if (text) {
$('site').value = text;
selectTab('generate');
$('site').dispatchEvent(new Event('input', { bubbles: true }));
}
}
} catch (e) {
}
}
document.addEventListener('visibilitychange', readShellEntry);
window.addEventListener('focus', readShellEntry);

function mergeBackup(payload) {
const incoming = normalizeStore(payload);
const byKey = new Map(entries.map((e) => [entryKey(e), e]));
for (const e of incoming.entries) byKey.set(entryKey(e), e);
const nextFolders = folders.slice();
for (const name of incoming.folders) {
if (!nextFolders.some((f) => f.toLowerCase() === name.toLowerCase())) nextFolders.push(name);
}
const colors = { ...folderColors };
for (const [name, color] of Object.entries(incoming.folderColors)) {
const known = nextFolders.find((f) => f.toLowerCase() === name.toLowerCase());
if (known && !isTint(colors[known])) colors[known] = color;
}
return { next: [...byKey.values()], nextFolders, colors, count: incoming.entries.length };
}

async function importBackupText(text) {
errorEl.textContent = '';
const payload = await openBackup(backupPassword(), text);
if (!payload) {
toast(status, t('backup.wrong'), 'warn');
return;
}
await storeReady;
const merged = mergeBackup(payload);
const ok = await commit(merged.next, '', merged.nextFolders, { silent: true, colors: merged.colors, replaceUnreadable: true });
if (ok) toast(status, tn('backup.imported', merged.count));
}

function pickBackupFile() {
errorEl.textContent = '';
backupFileEl.value = '';
backupFileEl.click();
}

const readText = (file) =>
new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(String(reader.result));
reader.onerror = () => reject(reader.error);
reader.readAsText(file);
});

async function readBackupFile() {
const file = backupFileEl.files && backupFileEl.files[0];
if (!file) return;
try {
await importBackupText(await readText(file));
} catch (failure) {
toast(status, t('backup.wrong'), 'warn');
} finally {
backupFileEl.value = '';
}
}

backupFileEl.addEventListener('change', readBackupFile);
$('backup-export').addEventListener('click', exportBackup);
$('backup-import').addEventListener('click', pickBackupFile);

function resetEverything() {
const ls = storage();
try {
if (ls) ls.removeItem(SETTINGS_STORE_KEY);
if (ls) ls.removeItem(LOCALE_STORE_KEY);
} catch (e) {
}
clearAfterMs = CLEAR_AFTER_MS;
paused = false;
wipeOnHide = false;
entryTtlMs = DEFAULT_ENTRY_TTL_MS;
renewOnCopy = true;
fieldReveal = { ...REVEAL_DEFAULTS };
applyFieldReveals();
$('length').value = String(DEFAULT_LENGTH);
$('counter').value = String(DEFAULT_COUNTER);
for (const k of CLASS_ORDER) $('c-' + k).checked = true;
$('wipe-on-hide').checked = false;
$('renew-on-copy').checked = true;
dropdowns.get('entry-ttl').set(String(DEFAULT_ENTRY_TTL_MS), { silent: true });
dropdowns.get('clear-after').set(String(clearAfterMs), { silent: true });
resetAsking = false;
confirmingKey = null;
movingKey = null;
renderResetRow();
entryQuery = '';
entryFolder = FOLDER_ALL;
entrySort = 'recent';
dropdowns.get('entries-sort').set('recent', { silent: true });
setFolderNew(false);
applyLocale(preferredLocale(null, navigator.languages || [navigator.language]));
try {
if (ls) ls.removeItem(LOCALE_STORE_KEY);
} catch (e) {
}
applyScheme('system', { persist: false });
clearEntered();
backupPasswordEl.value = '';
backupFileEl.value = '';
setBackupRevealed(false);
if (syncAppLock() !== 'unavailable') resetAppLock();
toast(status, t('settings.resetDone'));
}

const masterField = $('master');
const REVEAL_FIELDS = { site: ['site-reveal', 'site'], login: ['login-reveal', 'login'], master: ['reveal', 'master'] };
const REVEAL_DEFAULTS = { site: true, login: true, master: false };
let fieldReveal = { ...REVEAL_DEFAULTS };
function setFieldRevealed(which, on, { persist = true } = {}) {
const [buttonId, inputId] = REVEAL_FIELDS[which];
$(inputId).type = on ? 'text' : 'password';
$(buttonId).setAttribute('aria-pressed', on ? 'true' : 'false');
fieldReveal[which] = Boolean(on);
if (persist) writeSettings({ fieldReveal });
}
function readFieldReveal(raw) {
const out = { ...REVEAL_DEFAULTS };
if (raw && typeof raw === 'object') {
for (const which of Object.keys(REVEAL_FIELDS)) if (typeof raw[which] === 'boolean') out[which] = raw[which];
}
return out;
}
function applyFieldReveals() {
for (const which of Object.keys(REVEAL_FIELDS)) {
const [buttonId, inputId] = REVEAL_FIELDS[which];
$(inputId).type = fieldReveal[which] ? 'text' : 'password';
$(buttonId).setAttribute('aria-pressed', fieldReveal[which] ? 'true' : 'false');
}
}
function setRevealed(on) {
masterField.type = on ? 'text' : 'password';
$('reveal').setAttribute('aria-pressed', on ? 'true' : 'false');
}
$('reveal').addEventListener('click', () => setFieldRevealed('master', masterField.type === 'password'));
for (const which of ['site', 'login']) {
const [buttonId, inputId] = REVEAL_FIELDS[which];
$(buttonId).addEventListener('click', () => setFieldRevealed(which, $(inputId).type === 'password'));
setFieldRevealed(which, REVEAL_DEFAULTS[which], { persist: false });
}
function setBackupRevealed(on) {
backupPasswordEl.type = on ? 'text' : 'password';
$('backup-reveal').setAttribute('aria-pressed', on ? 'true' : 'false');
}
$('backup-reveal').addEventListener('click', () => setBackupRevealed(backupPasswordEl.type === 'password'));
document.addEventListener('visibilitychange', () => {
if (document.hidden) {
setRevealed(false);
setBackupRevealed(false);
if (revealedKeys.size || secretShownKeys.size) {
revealedKeys.clear();
secretShownKeys.clear();
rowEpoch += 1;
renderEntries();
}
closeShareQuestion();
if (wipeOnHide) clearEntered();
}
});

const helpButtons = [...document.querySelectorAll('.help')];
const closeTips = (except) => {
for (const b of helpButtons) if (b !== except) b.setAttribute('aria-expanded', 'false');
};
const dismissTips = () => {
for (const b of helpButtons) {
b.setAttribute('aria-expanded', 'false');
b.parentElement.classList.add('is-dismissed');
}
};
for (const b of helpButtons) {
const wrap = b.parentElement;
const restore = () => wrap.classList.remove('is-dismissed');
b.addEventListener('click', restore);
b.addEventListener('mouseenter', restore);
b.addEventListener('focus', restore);
b.addEventListener('click', () => {
const open = b.getAttribute('aria-expanded') === 'true';
closeTips(b);
b.setAttribute('aria-expanded', open ? 'false' : 'true');
});
}
function placeTips() {
for (const wrap of document.querySelectorAll('.help-wrap')) {
const row = wrap.parentElement;
const tip = wrap.querySelector('.tip');
if (!row || !tip) continue;
const anchor0 = [...row.children].find((child) => child !== wrap);
const box = row.getBoundingClientRect();
if (!box.width) continue;
const inner = anchor0 && !anchor0.matches('[data-i18n]') ? anchor0.querySelector('[data-i18n]') : null;
const anchor = inner || anchor0;
const a = (anchor || wrap).getBoundingClientRect();
const tail = Math.max(6, Math.min(box.width - 14, a.left - box.left + a.width / 2 - 4));
tip.style.setProperty('--tail', `${tail}px`);
}
}

document.addEventListener('click', (e) => {
if (!e.target.closest('.help-wrap')) dismissTips();
if (!e.target.closest('.dd')) {
closeDropdowns();
closeSuggests();
}
});
document.addEventListener('keydown', (e) => {
if (e.key === 'Escape') {
dismissTips();
closeDropdowns();
}
});

export { applyLocale };

let debounce = null;
function schedule() {
clearTimeout(debounce);
debounce = setTimeout(update, 120);
}

const NOT_DERIVATION = new Set(['entries-filter', 'folder-name', 'clear-after', 'entry-ttl', 'wipe-on-hide', 'renew-on-copy', 'backup-password']);
for (const el of document.querySelectorAll('input')) {
if (NOT_DERIVATION.has(el.id)) continue;
el.addEventListener('input', () => {
if (el.id === 'master') status.textContent = '';
if (el.id === 'length' || el.id === 'counter' || el.id.startsWith('c-')) storeInputs();
armClearFields();
syncGenActions();
schedule();
});
}
makeSuggest($('site'), $('site-suggest'), { other: $('login'), pick: 'site' });
makeSuggest($('login'), $('login-suggest'), { other: $('site'), pick: 'login' });

function appLock() {
return $('app-lock');
}
function appLockBackgroundRow() {
return $('lock-background-row');
}
function appLockBackground() {
return $('app-lock-background');
}
function paintAppLock(state, background) {
const control = appLock();
const usable = state === 'on' || state === 'off';
control.disabled = !usable;
control.checked = state === 'on';
const child = appLockBackground();
const row = appLockBackgroundRow();
const childUsable = state === 'on' && background !== null;
const wasHidden = row.classList.contains('hidden');
row.classList.toggle('hidden', state !== 'on');
child.disabled = !childUsable;
child.checked = childUsable ? background === true : false;
if (wasHidden !== row.classList.contains('hidden')) placeTips();
}
const LOCK_IDLE_DEFAULT_MS = 900000;
function paintLockIdle(state) {
const bridge = window.TrovePassAndroid;
const on = state === 'on';
const idleRow = $('lock-idle-row');
const wasHidden = idleRow.classList.contains('hidden');
idleRow.classList.toggle('hidden', !on);
const idle = dropdowns.get('lock-idle');
const fromShell = bridge && typeof bridge.lockIdleMs === 'function' ? Number(bridge.lockIdleMs()) || 0 : LOCK_IDLE_DEFAULT_MS;
if (idle) idle.set(String(fromShell), { silent: true });
$('lock-idle').disabled = !on;
if (wasHidden !== idleRow.classList.contains('hidden')) placeTips();
}
const ACTIVITY_PING_MS = 1000;
let lastActivityPing = -Infinity;
function reportActivity() {
const bridge = window.TrovePassAndroid;
if (!bridge || typeof bridge.noteActivity !== 'function') return;
const now = Date.now();
if (now - lastActivityPing < ACTIVITY_PING_MS) return;
lastActivityPing = now;
try {
bridge.noteActivity();
} catch (e) {
}
}
for (const activityEvent of ['input', 'keydown', 'pointerdown']) {
document.addEventListener(activityEvent, reportActivity, { passive: true });
}
function syncAppLock() {
const bridge = window.TrovePassAndroid;
const state = bridge && typeof bridge.appLockState === 'function' ? bridge.appLockState() : 'unavailable';
const readBackground = bridge && typeof bridge.appLockBackground === 'function';
paintAppLock(state, readBackground ? bridge.appLockBackground() === true : null);
paintLockIdle(state);
return state;
}
function resetAppLock() {
const bridge = window.TrovePassAndroid;
if (!bridge || typeof bridge.setAppLock !== 'function') return;
bridge.setAppLock(false);
if (typeof bridge.setAppLockBackground === 'function') bridge.setAppLockBackground(false);
if (typeof bridge.setLockIdleMs === 'function') bridge.setLockIdleMs(LOCK_IDLE_DEFAULT_MS);
paintAppLock('off', false);
paintLockIdle('off');
}
appLock().addEventListener('change', () => {
const bridge = window.TrovePassAndroid;
if (!bridge || typeof bridge.setAppLock !== 'function') {
syncAppLock();
return;
}
bridge.setAppLock(appLock().checked);
});
appLockBackground().addEventListener('change', () => {
const bridge = window.TrovePassAndroid;
if (!bridge || typeof bridge.setAppLockBackground !== 'function') {
syncAppLock();
return;
}
bridge.setAppLockBackground(appLockBackground().checked);
});
makeDropdown($('lock-idle'), {
onChange: (next) => {
const bridge = window.TrovePassAndroid;
if (bridge && typeof bridge.setLockIdleMs === 'function') bridge.setLockIdleMs(Number(next) || 0);
else syncAppLock();
},
});
const resyncAppLockOnReturn = () => {
if (document.visibilityState !== 'hidden') syncAppLock();
};
document.addEventListener('visibilitychange', resyncAppLockOnReturn);
window.addEventListener('focus', resyncAppLockOnReturn);

$('wipe-on-hide').addEventListener('change', () => {
wipeOnHide = $('wipe-on-hide').checked;
writeSettings({ wipeOnHide });
});
$('renew-on-copy').addEventListener('change', () => {
renewOnCopy = $('renew-on-copy').checked;
writeSettings({ renewOnCopy });
});

copyBtn.addEventListener('click', () => copyValue(lastOut, status, t('gen.outLabel')));
outRevealBtn.addEventListener('click', () => {
outRevealed = !outRevealed;
paintOut();
});
$('save').addEventListener('click', saveCurrent);
$('clear').addEventListener('click', () => clearEntered());

const commitNewFolder = async () => {
if (await addFolder($('folder-name').value)) setFolderNew(false);
};
$('folder-add').addEventListener('click', commitNewFolder);
$('folder-cancel').addEventListener('click', () => setFolderNew(false));
$('folder-name').addEventListener('keydown', (e) => {
if (e.key === 'Enter') {
e.preventDefault();
commitNewFolder();
}
if (e.key === 'Escape') setFolderNew(false);
});
$('reset-settings').addEventListener('click', () => {
resetAsking = true;
armQuestions(renderResetRow);
$('reset-cancel').focus();
});
$('reset-cancel').addEventListener('click', () => {
resetAsking = false;
renderResetRow();
});
$('reset-confirm').addEventListener('click', () => {
if (!confirmArmed()) return;
errorEl.textContent = '';
resetEverything();
});
$('clear-entries').addEventListener('click', () => {
askToConfirm('all');
$('clear-cancel').focus();
});
$('folder-delete-cancel').addEventListener('click', () => {
folderDeleteAsking = false;
renderEntries();
$('folder-delete').focus();
});
$('folder-delete-confirm').addEventListener('click', () => {
if (!confirmArmed()) return;
const name = entryFolder;
folderDeleteAsking = false;
errorEl.textContent = '';
deleteFolder(name);
});
$('clear-cancel').addEventListener('click', () => {
confirmingKey = null;
renderEntries();
});
$('clear-confirm').addEventListener('click', () => {
if (!confirmArmed()) return;
errorEl.textContent = '';
confirmingKey = null;
clearEverything();
});

{
const s = readSettings();
clearAfterMs = Number.isFinite(s.clearAfterMs) ? s.clearAfterMs : CLEAR_AFTER_MS;
paused = s.paused === true;
wipeOnHide = s.wipeOnHide === true;
entryTtlMs = Number.isFinite(s.entryTtlMs) && s.entryTtlMs >= 0 ? s.entryTtlMs : DEFAULT_ENTRY_TTL_MS;
renewOnCopy = s.renewOnCopy !== false;
fieldReveal = readFieldReveal(s.fieldReveal);
applyFieldReveals();
applyStoredInputs(s);
applyScheme(typeof s.scheme === 'string' ? s.scheme : 'system', { persist: false });
$('wipe-on-hide').checked = wipeOnHide;
$('renew-on-copy').checked = renewOnCopy;
dropdowns.get('clear-after').set(String(clearAfterMs), { silent: true });
dropdowns.get('entry-ttl').set(String(entryTtlMs), { silent: true });
const preferred = preferredLocale(
storage() ? storage().getItem(LOCALE_STORE_KEY) : null,
navigator.languages || [navigator.language]
);
dropdowns.get('locale').set(setLocale(preferred), { silent: true });
applyDom();
renderTimerOptions();
for (const d of dropdowns.values()) d.refresh();
queueFitTabs();
selectTab(TABS[0], { animate: false });
}
const PIANO_SCALE = [0, 2, 4, 7, 9];
const PIANO_ROOT = 48;
export function pianoFreq(i, n) {
const semitone = 12 * Math.floor(i / PIANO_SCALE.length) + PIANO_SCALE[i % PIANO_SCALE.length];
return 440 * 2 ** ((PIANO_ROOT + semitone - 69) / 12);
}
const aboutFacts = [...document.querySelectorAll('#panel-about .about-fact')];
export const aboutNotes = aboutFacts.map((_, i) => pianoFreq(i, aboutFacts.length));
let pianoCtx = null;
function playNote(freq) {
const Ctx = window.AudioContext || window.webkitAudioContext;
if (!Ctx) return;
if (!pianoCtx) pianoCtx = new Ctx();
const ctx = pianoCtx;
if (ctx.state === 'suspended') ctx.resume().catch(() => {});
const t = ctx.currentTime;
const voice = ctx.createGain();
voice.gain.setValueAtTime(0.0001, t);
voice.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
voice.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
voice.connect(ctx.destination);
for (const [mult, level] of [[1, 1], [2, 0.4], [3, 0.15], [4, 0.06]]) {
const osc = ctx.createOscillator();
const g = ctx.createGain();
osc.type = 'sine';
osc.frequency.value = freq * mult;
g.gain.value = level;
osc.connect(g).connect(voice);
osc.start(t);
osc.stop(t + 1.2);
}
}
for (const [i, fact] of aboutFacts.entries()) {
fact.addEventListener('click', () => {
playNote(aboutNotes[i]);
fact.classList.remove('struck');
void fact.offsetWidth;
fact.classList.add('struck');
});
fact.addEventListener('animationend', () => fact.classList.remove('struck'));
}

renderEntries();
renderFingerprint('');
armClearFields();
schedule();
const bootStore = storage();
const bootPlain = bootStore && !isEnvelope(parse(storageGet(bootStore, SEALED_STORE_KEY) || 'null'))
? readPlainStore(bootStore)
: null;
if (bootPlain) {
({ entries, folders, folderColors } = bootPlain);
storeLoaded = true;
renderEntries();
}
const storeReady = loadStore().then((store) => {
({ entries, folders, folderColors } = store);
storeLoaded = true;
renderEntries();
pruneExpired();
});

readShellEntry();
