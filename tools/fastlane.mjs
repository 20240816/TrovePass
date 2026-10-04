// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BRAND } from '../src/brand.js';
import { SPW_VERSION } from '../src/version.js';
import { LOCALES } from '../web/i18n.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const METADATA_DIR = path.join(ROOT, 'fastlane', 'metadata', 'android');

export const LIMITS = {
title: 30,
short_description: 80,
full_description: 4000,
changelog: 500,
};

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const recipeFieldRe = (name, value) => new RegExp(`${name}:[ \\t]*'?${escapeRe(value)}'?(?=\\s|$)`);

export function versionCode(version) {
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
if (!m) throw new Error(`fastlane: "${version}" is not a x.y.z version`);
const [major, minor, patch] = m.slice(1).map(Number);
if (minor > 99 || patch > 99) {
throw new Error(`fastlane: minor and patch must be 0..99 (got ${minor}.${patch}) for the versionCode scheme`);
}
return major * 10000 + minor * 100 + patch;
}

export function nextVersion(version) {
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim());
if (!m) throw new Error(`fastlane: "${version}" is not a x.y.z version`);
let [major, minor, patch] = m.slice(1).map(Number);
patch += 1;
if (patch > 99) {
patch = 0;
minor += 1;
}
if (minor > 99) {
minor = 0;
major += 1;
}
const next = `${major}.${minor}.${patch}`;
versionCode(next);
return next;
}

const COPY_DIR = path.join(ROOT, 'tools', 'listing-copy');
const LISTING_NAMES = { en: 'en-US', zh: 'zh-CN', 'zh-Hant': 'zh-TW' };
export const LISTING_EXTRAS = { 'pt-BR': 'written and published already; the app serves Brazil with its `pt` dictionary' };

export const APP_LISTING_LOCALES = Object.keys(LOCALES).map((code) => LISTING_NAMES[code] || code).sort();

export const LISTING_LOCALES = [...APP_LISTING_LOCALES, ...Object.keys(LISTING_EXTRAS)].sort();
const DEFAULT_LOCALE = 'en-US';

function readCopy(locale) {
const authored = path.join(COPY_DIR, `${locale}.txt`);
if (fs.existsSync(authored)) {
const text = fs.readFileSync(authored, 'utf8').replace(/\r\n/g, '\n');
const cut = text.indexOf('\n---\n');
if (cut === -1) throw new Error(`fastlane: ${path.relative(ROOT, authored)} needs the summary, a --- line, then the description`);
return { short: text.slice(0, cut).trim(), full: text.slice(cut + 5).trim() };
}
const published = (name) => {
const file = path.join(METADATA_DIR, locale, name);
return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
};
return { short: published('short_description.txt'), full: published('full_description.txt') };
}

export function buildMetadata(brand = BRAND, locale = DEFAULT_LOCALE) {
const copy = readCopy(locale);
const swap = (text) => text.split('TrovePass').join(brand.name);
return {
'title.txt': brand.name,
'short_description.txt': swap(copy.short),
'full_description.txt': swap(copy.full),
};
}

export function statesLanguageCount(text, count = Object.keys(LOCALES).length) {
return typeof text === 'string' && new RegExp(`(?:^|\\D)${count}(?:\\D|$)`).test(text);
}

export function checkMetadata(texts) {
const problems = [];
const need = (name, max) => {
const text = texts[name];
if (typeof text !== 'string' || !text.trim()) {
problems.push(`${name}: missing or empty`);
return;
}
const chars = [...text].length;
if (chars > max) problems.push(`${name}: ${chars} characters (limit ${max})`);
if (/\bTODO\b/.test(text) || /YOUR_HANDLE/i.test(text) || /<[a-z-]+>/i.test(text)) {
problems.push(`${name}: still contains a placeholder`);
}
};
need('title.txt', LIMITS.title);
need('short_description.txt', LIMITS.short_description);
need('full_description.txt', LIMITS.full_description);
if (texts['title.txt'] && texts['title.txt'].trim() !== BRAND.name) {
problems.push(`title.txt: "${texts['title.txt'].trim()}" does not match the brand name "${BRAND.name}"`);
}
if (texts['full_description.txt'] && !statesLanguageCount(texts['full_description.txt'])) {
problems.push(`full_description.txt: does not state the language count (the app has ${Object.keys(LOCALES).length} dictionaries)`);
}
return problems;
}

export function readMetadata(dir = METADATA_DIR, locale = DEFAULT_LOCALE) {
const texts = {};
for (const name of Object.keys(buildMetadata(BRAND, locale))) {
const file = path.join(dir, locale, name);
texts[name] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}
return texts;
}

function writeMetadata(dir, locale, texts) {
const target = path.join(dir, locale);
fs.mkdirSync(target, { recursive: true });
for (const [name, text] of Object.entries(texts)) {
fs.writeFileSync(path.join(target, name), text.replace(/\n?$/, '\n'));
console.log(`wrote fastlane/metadata/android/${locale}/${name}`);
}
}

export function readGradleVersion(file = path.join(ROOT, 'android', 'app', 'build.gradle')) {
const text = fs.readFileSync(file, 'utf8');
const name = /^\s*versionName\s+'([^']+)'/m.exec(text);
const code = /^\s*versionCode\s+(\d+)/m.exec(text);
return { version: name && name[1], code: code ? Number(code[1]) : null, file, text };
}

export function stampGradle(version, file = path.join(ROOT, 'android', 'app', 'build.gradle')) {
const code = versionCode(version);
const before = fs.readFileSync(file, 'utf8');
const after = before
.replace(/^(\s*)versionCode\s+\d+/m, (_m, indent) => `${indent}versionCode ${code}`)
.replace(/^(\s*)versionName\s+'[^']+'/m, (_m, indent) => `${indent}versionName '${version}'`);
if (after === before) {
if (new RegExp(`versionCode\\s+${code}\\b`).test(before) && before.includes(`versionName '${version}'`)) {
console.log(`already ${path.relative(ROOT, file) || file}: versionName '${version}', versionCode ${code}`);
return { version, code };
}
throw new Error('fastlane: the Android module has no versionCode/versionName to stamp');
}
fs.writeFileSync(file, after);
console.log(`stamped ${path.relative(ROOT, file) || file}: versionName '${version}', versionCode ${code}`);
return { version, code };
}

export function stampRelease(version, options = {}) {
const gradleFile = options.gradle || path.join(ROOT, 'android', 'app', 'build.gradle');
const versionFile = options.versionFile || path.join(ROOT, 'src', 'version.js');
const result = stampGradle(version, gradleFile);
const before = fs.readFileSync(versionFile, 'utf8');
const after = before.replace(/const SPW_VERSION = '[^']*';/, `const SPW_VERSION = '${version}';`);
if (after === before) {
if (!new RegExp(`const SPW_VERSION = '${escapeRe(version)}';`).test(before)) {
throw new Error('fastlane: src/version.js has no SPW_VERSION to stamp');
}
console.log(`already ${path.relative(ROOT, versionFile) || versionFile}: ${version}`);
return result;
}
fs.writeFileSync(versionFile, after);
console.log(`stamped ${path.relative(ROOT, versionFile) || versionFile}: ${version}`);
return result;
}

function writeChangelog(dir, locale, version, note) {
const code = versionCode(version);
if (typeof note !== 'string' || !note.trim()) throw new Error('fastlane: a changelog needs a note');
const chars = [...note.trim()].length;
if (chars > LIMITS.changelog) throw new Error(`fastlane: changelog is ${chars} characters (limit ${LIMITS.changelog})`);
const target = path.join(dir, locale, 'changelogs');
fs.mkdirSync(target, { recursive: true });
const file = path.join(target, `${code}.txt`);
fs.writeFileSync(file, note.trim() + '\n');
console.log(`wrote fastlane/metadata/android/${locale}/changelogs/${code}.txt (v${version} -> versionCode ${code})`);
}

function main(argv) {
const locale = DEFAULT_LOCALE;
if (argv.includes('--write')) {
for (const target of LISTING_LOCALES) {
writeMetadata(METADATA_DIR, target, buildMetadata(BRAND, target));
}
console.log(`fastlane: ${LISTING_LOCALES.length} locale(s) generated — ${LISTING_LOCALES.join(', ')}`);
return 0;
}
const ci = argv.indexOf('--changelog');
if (ci !== -1) {
const version = argv[ci + 1];
const note = argv[ci + 2] || '';
writeChangelog(METADATA_DIR, locale, version, note);
return 0;
}
const gi = argv.indexOf('--stamp');
if (gi !== -1) {
stampRelease(argv[gi + 1]);
return 0;
}
let problems = [];
for (const target of LISTING_LOCALES) {
problems = problems.concat(checkMetadata(readMetadata(METADATA_DIR, target)).map((p) => `${target}: ${p}`));
}
const authored = fs.existsSync(COPY_DIR)
? fs.readdirSync(COPY_DIR).filter((n) => n.endsWith('.txt')).map((n) => n.slice(0, -4)).sort()
: null;
const declared = [...LISTING_LOCALES].sort();
if (authored) {
const missingCopy = declared.filter((l) => !authored.includes(l));
const extraCopy = authored.filter((l) => !declared.includes(l));
if (missingCopy.length) problems.push(`no authored copy for: ${missingCopy.join(', ')} (tools/listing-copy/<locale>.txt)`);
if (extraCopy.length) problems.push(`authored copy with no app locale: ${extraCopy.join(', ')}`);
}
const dirs = fs.readdirSync(METADATA_DIR).filter((n) => fs.statSync(path.join(METADATA_DIR, n)).isDirectory()).sort();
const missingDir = declared.filter((l) => !dirs.includes(l));
const extraDir = dirs.filter((l) => !declared.includes(l));
if (missingDir.length) problems.push(`no listing directory for: ${missingDir.join(', ')}`);
if (extraDir.length) problems.push(`listing directory the app has no locale for: ${extraDir.join(', ')} (declare it in LISTING_EXTRAS with the reason)`);
const english = {
short: readMetadata(METADATA_DIR, DEFAULT_LOCALE)['short_description.txt'],
full: readMetadata(METADATA_DIR, DEFAULT_LOCALE)['full_description.txt'],
};
for (const locale of LISTING_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
const texts = readMetadata(METADATA_DIR, locale);
if (texts['full_description.txt'] === english.full) problems.push(`${locale}: the description is the English one`);
if (texts['short_description.txt'] === english.short) problems.push(`${locale}: the summary is the English one`);
}
const changelogDir = path.join(METADATA_DIR, locale, 'changelogs');
for (const name of fs.existsSync(changelogDir) ? fs.readdirSync(changelogDir).sort() : []) {
const text = fs.readFileSync(path.join(changelogDir, name), 'utf8');
if (!statesLanguageCount(text)) problems.push(`${locale}/changelogs/${name}: does not state the language count`);
}
if (problems.length) {
for (const p of problems) console.error(`fastlane: ${p}`);
console.error(`\nfastlane: ${problems.length} problem(s). Run with --write to regenerate, or edit the files.`);
return 1;
}
console.log(`fastlane: metadata OK for ${LISTING_LOCALES.length} locale(s) (${LISTING_LOCALES.join(', ')}) — app id ${BRAND.appId}, next versionCode ${versionCode(SPW_VERSION)}`);
return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
process.exit(main(process.argv.slice(2)));
}
