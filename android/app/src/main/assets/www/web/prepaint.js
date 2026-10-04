// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
try {
var stored = JSON.parse(localStorage.getItem('trovepass.settings.v1') || 'null');
if (stored && (stored.scheme === 'light' || stored.scheme === 'dark')) {
document.documentElement.setAttribute('data-scheme', stored.scheme);
}
} catch (error) {
}

var TIER_TIGHT = 660;
var TIER_COMPACT = 800;
var TAB_FS_MIN = 11;
function fitTabs() {
var strip = document.getElementById('tabs');
if (!strip || !strip.children.length || !strip.children[0].clientWidth) return;
strip.style.removeProperty('--tab-fs');
var size = parseFloat(getComputedStyle(strip.children[0]).fontSize);
if (!Number.isFinite(size)) return;
for (var pass = 0; pass < 5; pass++) {
var worst = 1;
for (var n = 0; n < strip.children.length; n++) {
var cell = strip.children[n];
var room = cell.clientWidth - 1;
if (room > 0 && cell.scrollWidth > room) worst = Math.min(worst, room / cell.scrollWidth);
}
if (worst >= 1) break;
size = Math.max(TAB_FS_MIN, size * worst);
strip.style.setProperty('--tab-fs', size.toFixed(2) + 'px');
}
}
window.trovePassFitTabs = fitTabs;
var tierRoot = document.documentElement;
tierRoot.classList.toggle('tier-tight', window.innerHeight <= TIER_TIGHT);
tierRoot.classList.toggle('tier-compact', window.innerHeight <= TIER_COMPACT);
fitTabs();
