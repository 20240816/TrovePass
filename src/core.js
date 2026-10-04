// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
const CHARSETS = {
lowercase: 'abcdefghijklmnopqrstuvwxyz',
uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
digits: '0123456789',
symbols: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
};

const CLASS_ORDER = ['lowercase', 'uppercase', 'digits', 'symbols'];
const ITERATIONS = 100000;
const KEYLEN_BYTES = 32;
const MIN_LENGTH = 5;
const MAX_LENGTH = 35;

const DEFAULT_OPTIONS = {
length: 16,
classes: CLASS_ORDER.slice(),
counter: 1,
};

function _root() {
if (typeof window !== 'undefined') return window;
if (typeof self !== 'undefined') return self;
if (typeof global !== 'undefined') return global;
return null;
}

function _subtle() {
const root = _root();
const c = root ? root.crypto : null;
if (c && c.subtle) return c.subtle;
throw new Error('WebCrypto unavailable: needs crypto.subtle');
}

function _bytesToHex(bytes) {
let out = '';
for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
return out;
}

async function pbkdf2Hex(masterBytes, saltBytes, iterations, dkLenBytes) {
const subtle = _subtle();
const key = await subtle.importKey('raw', masterBytes, 'PBKDF2', false, ['deriveBits']);
const bits = await subtle.deriveBits(
{ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
key,
dkLenBytes * 8
);
return _bytesToHex(new Uint8Array(bits));
}

const FORMAT_V1 = 'v1';
const FORMAT_V2B = 'v2b';
const V2B_DELIMITER = '\u001f';

function normalizeFormat(input) {
if (input == null || input === '' || input === FORMAT_V1) return FORMAT_V1;
if (input === FORMAT_V2B) return FORMAT_V2B;
throw new Error('unknown password format ' + JSON.stringify(input) + ' (expected "v1" or "v2b")');
}

function normalizeClasses(input) {
try {
if (Array.isArray(input)) {
const out = CLASS_ORDER.filter((k) => input.indexOf(k) !== -1);
if (out.length) return out;
}
if (input && typeof input === 'object') {
const out = CLASS_ORDER.filter((k) => !!input[k]);
if (out.length) return out;
}
} catch (e) {}
return CLASS_ORDER.slice();
}

function saltFor(site, login, counter, format) {
const s = String(site);
const l = String(login == null ? '' : login);
const c = Number(counter).toString(16);
if (normalizeFormat(format) === FORMAT_V2B) return s + V2B_DELIMITER + l + V2B_DELIMITER + c;
return s + l + c;
}

async function entropyFor(master, site, login, counter, format) {
const enc = new TextEncoder();
const hex = await pbkdf2Hex(
enc.encode(master),
enc.encode(saltFor(site, login, counter, format)),
ITERATIONS,
KEYLEN_BYTES
);
return BigInt('0x' + hex);
}

function render(entropy, length, classes) {
const pool = classes.map((k) => CHARSETS[k]).join('');
if (!pool.length) throw new Error('no character classes selected');
let n = entropy;
const take = (d) => {
const r = n % d;
n = n / d;
return Number(r);
};
const out = [];
for (let i = 0; i < length - classes.length; i++) out.push(pool[take(BigInt(pool.length))]);
const extras = classes.map((k) => CHARSETS[k][take(BigInt(CHARSETS[k].length))]);
for (let i = 0; i < extras.length; i++) out.splice(take(BigInt(out.length)), 0, extras[i]);
return out.join('');
}

async function generatePassword(opts) {
const o = opts || {};
const master = String(o.master == null ? '' : o.master);
const site = String(o.site == null ? '' : o.site);
const login = o.login == null ? '' : String(o.login);
const counter = o.counter == null ? DEFAULT_OPTIONS.counter : Number(o.counter);
const length = o.length == null ? DEFAULT_OPTIONS.length : Number(o.length);
const classes = normalizeClasses(o.classes || o.profile || null);
const format = normalizeFormat(o.format);
if (!master) throw new Error('master password must not be empty');
if (!site) throw new Error('site must not be empty');
if (!(counter >= 1) || !Number.isFinite(counter)) throw new Error('counter must be >= 1');
if (!(length >= MIN_LENGTH && length <= MAX_LENGTH)) throw new Error('length must be ' + MIN_LENGTH + '..' + MAX_LENGTH);
const entropy = await entropyFor(master, site, login, counter, format);
return render(entropy, length, classes);
}

export {
generatePassword,
pbkdf2Hex,
normalizeClasses,
saltFor,
CHARSETS,
CLASS_ORDER,
FORMAT_V1,
FORMAT_V2B,
V2B_DELIMITER,
ITERATIONS,
MIN_LENGTH,
MAX_LENGTH,
};
