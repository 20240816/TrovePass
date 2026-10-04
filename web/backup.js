// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
import { bytesToB64, b64ToBytes } from './envelope.js';

export const BACKUP_PREFIX = 'trovepass-v1:';
export const BACKUP_VERSION = 1;
export const BACKUP_ITERATIONS = 600000;
export const BACKUP_ITER_LIMIT = BACKUP_ITERATIONS * 10;
export const BACKUP_ALG = 'PBKDF2-HMAC-SHA-256+AES-256-GCM';
export const BACKUP_KEY_BITS = 256;
export const BACKUP_ALG_LABEL = 'AES-256-GCM · PBKDF2-SHA-256';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AAD_PREFIX = 'trovepass.backup.v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

const isDoc = (doc) =>
!!doc &&
typeof doc === 'object' &&
doc.v === BACKUP_VERSION &&
doc.alg === BACKUP_ALG &&
Number.isInteger(doc.iter) &&
doc.iter >= 100000 &&
doc.iter <= BACKUP_ITER_LIMIT &&
typeof doc.salt === 'string' &&
typeof doc.iv === 'string' &&
typeof doc.ct === 'string';

const normalize = (text) => String(text === null || text === undefined ? '' : text).replace(/\s+/g, '');

export const isBackup = (text) => normalize(text).startsWith(BACKUP_PREFIX);

const docOf = (text) => {
if (!isBackup(text)) return null;
try {
return JSON.parse(dec.decode(b64ToBytes(normalize(text).slice(BACKUP_PREFIX.length))));
} catch (e) {
return null;
}
};

export function describeBackup(text) {
const doc = docOf(text);
return isDoc(doc) ? { v: doc.v, alg: doc.alg, iter: doc.iter, bytes: normalize(String(text === null || text === undefined ? '' : text)).length } : null;
}

const aadFor = (doc) => enc.encode(`${AAD_PREFIX}|${doc.v}|${doc.alg}|${doc.iter}`);

async function deriveKey(password, salt, iterations) {
const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
return crypto.subtle.deriveKey(
{ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
material,
{ name: 'AES-GCM', length: BACKUP_KEY_BITS },
false,
['encrypt', 'decrypt']
);
}

export async function sealBackup(password, payload) {
const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
const key = await deriveKey(password, salt, BACKUP_ITERATIONS);
const doc = { v: BACKUP_VERSION, alg: BACKUP_ALG, iter: BACKUP_ITERATIONS, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: '' };
const ct = await crypto.subtle.encrypt(
{ name: 'AES-GCM', iv, additionalData: aadFor(doc) },
key,
enc.encode(JSON.stringify(payload))
);
doc.ct = bytesToB64(new Uint8Array(ct));
return BACKUP_PREFIX + bytesToB64(enc.encode(JSON.stringify(doc)));
}

export async function openBackup(password, text) {
const doc = docOf(text);
if (!isDoc(doc)) return null;
try {
const key = await deriveKey(password, b64ToBytes(doc.salt), doc.iter);
const plain = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: b64ToBytes(doc.iv), additionalData: aadFor(doc) },
key,
b64ToBytes(doc.ct)
);
return JSON.parse(dec.decode(plain));
} catch (e) {
return null;
}
}
