// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The TrovePass contributors
async function fingerprintHash(masterPassword) {
const key = await crypto.subtle.importKey(
'raw',
new TextEncoder().encode(masterPassword),
{ name: 'HMAC', hash: 'SHA-256' },
false,
['sign']
);
const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(0)));
return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintFor(masterPassword) {
return { hash: await fingerprintHash(masterPassword) };
}
