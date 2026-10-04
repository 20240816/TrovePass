#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
import fs from 'node:fs';
import path from 'node:path';

export const STRIPPED_EXT = new Set(['.js', '.mjs', '.css', '.html', '.svg']);

const LICENCE = /SPDX-License-Identifier/;
const LICENCE_LINE = /SPDX-/;
const REGEX_KEYWORDS = new Set([
'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else',
'yield', 'await',
]);
const REGEX_PUNCT = new Set([
'(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '+', '-', '*', '%', '^', '~', '<', '>', '/',
]);

const isLineBreak = (c) => c === '\n' || c === '\r';
const isSpace = (c) => c === ' ' || c === '\t' || isLineBreak(c);
const isWordStart = (c) => /[A-Za-z_$]/.test(c);
const isWord = (c) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c) => c >= '0' && c <= '9';

export function fileDeclaration(text) {
const m = /^#![^\n]*\n/.exec(text) || /^<\?xml[^>]*\?>\s*/.exec(text);
return m ? m[0] : '';
}

export function licenceHeader(text) {
const decl = fileDeclaration(text);
let cursor = decl.length;
let last = -1;
for (;;) {
while (cursor < text.length && isSpace(text[cursor])) cursor += 1;
let end = -1;
if (text.startsWith('//', cursor)) end = text.indexOf('\n', cursor) + 1 || text.length;
else if (text.startsWith('/*', cursor)) {
const close = text.indexOf('*/', cursor + 2);
if (close !== -1) end = close + 2;
} else if (text.startsWith('<!--', cursor)) {
const close = text.indexOf('-->', cursor + 4);
if (close !== -1) end = close + 3;
}
if (end === -1) break;
if (LICENCE_LINE.test(text.slice(cursor, end))) last = end;
cursor = end;
}
if (last === -1) return '';
const head = text.slice(decl.length, last);
return LICENCE.test(head) ? head : '';
}

function takeBackIndent(out, before) {
const tail = out.length - out.replace(/[ \t]*$/, '').length;
return out.slice(0, out.length - Math.min(before.length, tail));
}

function atLineStart(text, i) {
return text.slice(text.lastIndexOf('\n', i - 1) + 1, i).trim() === '';
}

function markLines(removed, text, from, to) {
const first = text.slice(0, from).split('\n').length;
const last = text.slice(0, Math.max(to, from)).split('\n').length;
for (let line = first; line <= last; line += 1) removed.add(line);
}

function stripCommentSpan(text, i, n, out, removed, { openLen, closeToken, closeLen, keepNewline }) {
const close = text.indexOf(closeToken, i + openLen);
const end = close === -1 ? n : close + closeLen;
const lineStart = text.lastIndexOf('\n', i - 1) + 1;
const nl = text.indexOf('\n', end);
const lineEnd = nl === -1 ? n : nl;
const alone = text.slice(lineStart, i).trim() === '' && text.slice(end, lineEnd).trim() === '';
if (alone) {
out = takeBackIndent(out, text.slice(lineStart, i));
markLines(removed, text, lineStart, lineEnd - 1);
return { out, i: nl === -1 ? n : nl + 1 };
}
out = out.replace(/[ \t]+$/, '');
if (keepNewline) out += text.slice(i, end).includes('\n') ? '\n' : ' ';
return { out, i: end };
}

function scanJs(text, start, stopAtBrace) {
const removed = new Set();
let out = '';
let i = start;
const n = text.length;
let last = '';
let braces = 0;

while (i < n) {
const c = text[i];

if (isSpace(c)) {
if ((c === ' ' || c === '\t') && atLineStart(text, i)) {
i += 1;
continue;
}
out += c;
i += 1;
continue;
}

if (c === '/' && text[i + 1] === '/') {
const nl = text.indexOf('\n', i);
const end = nl === -1 ? n : nl;
const lineStart = text.lastIndexOf('\n', i - 1) + 1;
const before = text.slice(lineStart, i);
if (before.trim() === '') {
out = takeBackIndent(out, before);
markLines(removed, text, lineStart, end - 1);
i = nl === -1 ? n : nl + 1;
} else {
out = out.replace(/[ \t]+$/, '');
i = end;
}
continue;
}
if (c === '/' && text[i + 1] === '*') {
const r = stripCommentSpan(text, i, n, out, removed, { openLen: 2, closeToken: '*/', closeLen: 2, keepNewline: true });
out = r.out;
i = r.i;
continue;
}

if (c === '"' || c === "'") {
let j = i + 1;
while (j < n && text[j] !== c) {
if (text[j] === '\\') j += 2;
else if (isLineBreak(text[j])) break;
else j += 1;
}
const end = j < n && text[j] === c ? j + 1 : j;
out += text.slice(i, end);
i = end;
last = 'value';
continue;
}
if (c === '`') {
out += '`';
let j = i + 1;
let closed = false;
while (j < n) {
const d = text[j];
if (d === '\\') {
out += text.slice(j, j + 2);
j += 2;
} else if (d === '`') {
out += '`';
j += 1;
closed = true;
break;
} else if (d === '$' && text[j + 1] === '{') {
const inner = scanJs(text, j + 2, true);
for (const line of inner.removed) removed.add(line);
out += '${' + inner.out + '}';
j = inner.end + 1;
} else {
out += d;
j += 1;
}
}
if (!closed) j = n;
i = j;
last = 'value';
continue;
}

if (c === '/') {
const allowed = last === '' || last === 'op';
if (allowed) {
let j = i + 1;
let inClass = false;
let closed = false;
while (j < n) {
const d = text[j];
if (d === '\\') j += 2;
else if (isLineBreak(d)) break;
else if (inClass) {
if (d === ']') inClass = false;
j += 1;
} else if (d === '[') {
inClass = true;
j += 1;
} else if (d === '/') {
closed = true;
break;
} else j += 1;
}
if (closed) {
let k = j + 1;
while (k < n && isWord(text[k])) k += 1;
out += text.slice(i, k);
i = k;
last = 'value';
continue;
}
}
out += c;
i += 1;
last = 'op';
continue;
}

if (c === '}' && stopAtBrace && braces === 0) {
return { out, removed, end: i };
}

if (isWordStart(c)) {
let j = i;
while (j < n && isWord(text[j])) j += 1;
const word = text.slice(i, j);
out += word;
i = j;
last = REGEX_KEYWORDS.has(word) ? 'op' : 'value';
continue;
}
if (isDigit(c)) {
let j = i;
while (j < n && (isWord(text[j]) || text[j] === '.')) j += 1;
out += text.slice(i, j);
i = j;
last = 'value';
continue;
}
if (c === '{') braces += 1;
else if (c === '}') braces = Math.max(0, braces - 1);
out += c;
i += 1;
last = c === ')' || c === ']' || c === '}' ? 'value' : REGEX_PUNCT.has(c) ? 'op' : 'value';
}
return { out, removed, end: n };
}

export function stripJsSource(text) {
const { out, removed } = scanJs(text, 0, false);
return { text: out, removed, licence: licenceHeader(text) };
}

export function stripCssSource(text) {
const removed = new Set();
let out = '';
let i = 0;
const n = text.length;
while (i < n) {
const c = text[i];
if (c === '/' && text[i + 1] === '*') {
const r = stripCommentSpan(text, i, n, out, removed, { openLen: 2, closeToken: '*/', closeLen: 2, keepNewline: false });
out = r.out;
i = r.i;
continue;
}
if (c === '"' || c === "'") {
let j = i + 1;
while (j < n && text[j] !== c) {
if (text[j] === '\\') j += 2;
else j += 1;
}
const end = j < n ? j + 1 : n;
out += text.slice(i, end);
i = end;
continue;
}
if (text.startsWith('url(', i)) {
const close = text.indexOf(')', i);
const end = close === -1 ? n : close + 1;
out += text.slice(i, end);
i = end;
continue;
}
if ((c === ' ' || c === '\t') && atLineStart(text, i)) {
i += 1;
continue;
}
out += c;
i += 1;
}
return { text: out, removed, licence: licenceHeader(text) };
}

export function stripHtmlSource(text) {
const removed = new Set();
let out = '';
let i = 0;
const n = text.length;
while (i < n) {
if (text.startsWith('<!--', i)) {
const r = stripCommentSpan(text, i, n, out, removed, { openLen: 4, closeToken: '-->', closeLen: 3, keepNewline: false });
out = r.out;
i = r.i;
continue;
}
const tag = /^<(script|style)\b([^>]*)>/i.exec(text.slice(i, i + 400));
if (tag) {
const openEnd = i + tag[0].length;
const name = tag[1].toLowerCase();
const attrs = tag[2] || '';
const closeAt = text.toLowerCase().indexOf(`</${name}`, openEnd);
const innerEnd = closeAt === -1 ? n : closeAt;
const inner = text.slice(openEnd, innerEnd);
const isJs = name === 'script' && !/\btype\s*=\s*["']?[^"'>]*\b(json|text\/template|importmap)/i.test(attrs);
const strip = name === 'style'
? stripCssSource(inner)
: isJs ? stripJsSource(inner) : { text: inner, removed: new Set() };
const base = text.slice(0, openEnd).split('\n').length - 1;
for (const line of strip.removed) removed.add(line + base);
out += text.slice(i, openEnd) + strip.text;
i = innerEnd;
continue;
continue;
}
const verbatim = /^<(pre|textarea)\b/i.exec(text.slice(i, i + 12));
if (verbatim) {
const closeAt = text.toLowerCase().indexOf('</' + verbatim[1].toLowerCase(), i);
const end = closeAt === -1 ? n : closeAt;
out += text.slice(i, end);
i = end;
continue;
}
if ((text[i] === ' ' || text[i] === '\t') && atLineStart(text, i)) {
i += 1;
continue;
}
out += text[i];
i += 1;
}
return { text: out, removed, licence: licenceHeader(text) };
}

export function stripSource(name, text) {
const ext = path.extname(String(name)).toLowerCase();
if (!STRIPPED_EXT.has(ext)) return { text, removed: new Set(), licence: '' };
const decl = fileDeclaration(text);
const body = decl ? text.slice(decl.length) : text;
const scanner = ext === '.css' ? stripCssSource : ext === '.html' || ext === '.svg' ? stripHtmlSource : stripJsSource;
const inner = scanner(body);
const declLines = decl ? (decl.match(/\n/g) || []).length : 0;
const removed = decl ? new Set([...inner.removed].map((line) => line + declLines)) : inner.removed;
const head = decl + (inner.licence ? inner.licence.trimEnd() + '\n' : '');
return { text: head + inner.text.replace(/^[ \t\r\n]+/, ''), removed, licence: inner.licence };
}

export const stripFor = (name, text) => stripSource(name, text).text;

export function commentsOutsideStrip(name, text) {
if (commentSyntax(name) !== 'hash') return [];
const lines = [];
for (const [index, line] of text.split('\n').entries()) {
if (/^\s*#/.test(line)) continue;
if (/[ \t]#/.test(line)) lines.push(index + 1);
}
return lines;
}

export const hasComments = (name, text) => stripFor(name, text) !== text;

export const withoutJavaComments = (text) => {
let out = '';
let i = 0;
const n = text.length;
while (i < n) {
const c = text[i];
const next = text[i + 1];
if (c === '"' || c === "'") {
out += c;
i += 1;
while (i < n && text[i] !== c) {
if (text[i] === '\\') {
out += text[i] + (text[i + 1] || '');
i += 2;
} else {
out += text[i];
i += 1;
}
}
if (i < n) {
out += c;
i += 1;
}
continue;
}
if (c === '/' && next === '*') {
const end = text.indexOf('*/', i + 2);
i = end === -1 ? n : end + 2;
continue;
}
if (c === '/' && next === '/') {
const end = text.indexOf('\n', i);
i = end === -1 ? n : end;
continue;
}
out += c;
i += 1;
}
return out;
};

const TREE_SYNTAX = new Map([
['.java', 'c'],
['.gradle', 'c'],
['.pro', 'hash'],
['.xml', 'xml'],
['.yml', 'hash'],
['.gitignore', 'hash'],
['.properties', 'hash'],
]);

export function commentSyntax(name) {
const rel = String(name);
const ext = path.extname(rel).toLowerCase();
if (STRIPPED_EXT.has(ext)) return 'build';
return TREE_SYNTAX.get(ext) || TREE_SYNTAX.get(path.basename(rel).toLowerCase()) || null;
}

export function stripTreeComments(name, text) {
const syntax = commentSyntax(name);
if (syntax === 'build') return stripFor(name, text);
if (!syntax) return text;
const decl = fileDeclaration(text);
const body = decl ? text.slice(decl.length) : text;
const licence = licenceHeader(text);
const stripped =
syntax === 'xml'
? body.replace(/<!--[\s\S]*?-->/g, '')
: syntax === 'c'
? withoutJavaComments(body)
: body
.split('\n')
.filter((line) => !/^\s*#/.test(line))
.join('\n');
const head = decl + (licence ? licence.trimEnd() + '\n' : '');
const rest = stripped.replace(/^[ \t\r\n]+/, '');
return head + rest.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}

export function lostCode(source, result) {
const kept = new Set(result.text.split('\n').map((line) => line.trim()));
const lost = [];
for (const [index, line] of source.split('\n').entries()) {
const number = index + 1;
if (result.removed.has(number)) continue;
if (!line.trim()) continue;
if (/\/\/|\/\*|\*\/|<!--|-->/.test(line)) continue;
if (!kept.has(line.trim())) lost.push(number);
}
return lost;
}

export function walkFiles(dir, rel = '', out = []) {
for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
const child = rel ? `${rel}/${entry.name}` : entry.name;
if (entry.isDirectory()) walkFiles(dir, child, out);
else if (entry.isFile()) out.push(child);
}
return out;
}
