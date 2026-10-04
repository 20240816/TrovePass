// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
const STORE_KEY_NAME = 'entries';
const DB_NAME = 'trovepass.keys';
const DB_VERSION = 1;
const OBJECT_STORE = 'keys';

export const ENVELOPE_VERSION = 3;
export const SEALED_STORE_KEY = 'trovepass.entries.v3';
const AAD = 'trovepass.entries.v3';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const bytesToB64 = (bytes) => {
let binary = '';
for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
return btoa(binary);
};
export const b64ToBytes = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

export const isEnvelope = (value) =>
!!value &&
typeof value === 'object' &&
value.v === ENVELOPE_VERSION &&
typeof value.iv === 'string' &&
typeof value.ct === 'string';

export const generateStoreKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export async function seal(key, payload) {
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt(
{ name: 'AES-GCM', iv, additionalData: enc.encode(AAD) },
key,
enc.encode(JSON.stringify(payload))
);
return { v: ENVELOPE_VERSION, iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

export async function openEnvelope(key, envelope) {
if (!key || !isEnvelope(envelope)) return null;
try {
const plain = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: b64ToBytes(envelope.iv), additionalData: enc.encode(AAD) },
key,
b64ToBytes(envelope.ct)
);
return JSON.parse(dec.decode(plain));
} catch (e) {
return null;
}
}


const openDb = (factory) =>
new Promise((resolve, reject) => {
if (!factory || typeof factory.open !== 'function') return reject(new Error('no indexedDB'));
const request = factory.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = () => {
if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
};
request.onsuccess = () => resolve(request.result);
request.onerror = () => reject(request.error);
request.onblocked = () => reject(new Error('indexedDB blocked'));
});

const idbGet = (db, key) =>
new Promise((resolve, reject) => {
const request = db.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(key);
request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
request.onerror = () => reject(request.error);
});

const idbPut = (db, key, value) =>
new Promise((resolve, reject) => {
const tx = db.transaction(OBJECT_STORE, 'readwrite');
tx.objectStore(OBJECT_STORE).put(value, key);
tx.oncomplete = () => resolve(true);
tx.onerror = () => reject(tx.error);
tx.onabort = () => reject(tx.error);
});

export async function loadOrCreateKey(factory = window.indexedDB) {
let db = null;
try {
db = await openDb(factory);
const existing = await idbGet(db, STORE_KEY_NAME);
if (existing && existing.type === 'secret' && existing.algorithm && existing.algorithm.name === 'AES-GCM') {
return existing;
}
const key = await generateStoreKey();
await idbPut(db, STORE_KEY_NAME, key);
return key;
} catch (e) {
return null;
} finally {
try {
if (db) db.close();
} catch (e) {
}
}
}
