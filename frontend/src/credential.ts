import { notifyDeviceForgotten } from './device-sync.ts';
const encoder = new TextEncoder();
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export type Credential = { id: string; secret: string; bootstrapKey: string; courseId?: string; backup: 'unconfirmed' | 'export_action_taken' | 'restore_checked' };
function base32(bytes: Uint8Array) {
  let out = '', bits = 0, value = 0;
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(value >>> bits) & 31]; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode32(text: string) {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const c of text) { value = (value << 5) | alphabet.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); } }
  return new Uint8Array(bytes);
}
export function secretBytes(c: Credential) { return Uint8Array.from(atob(c.secret.replace(/-/g, '+').replace(/_/g, '/') + '='), x => x.charCodeAt(0)); }
async function hash(prefix: string, bytes: Uint8Array) { const p = encoder.encode(prefix + '\0'); const data = new Uint8Array(p.length + bytes.length); data.set(p); data.set(bytes, p.length); return new Uint8Array(await crypto.subtle.digest('SHA-256', data)); }
export async function fromSecret(bytes: Uint8Array): Promise<Credential> {
  if (bytes.length !== 32) throw new Error('INVALID_CODE');
  const id = (await hash('learning-credential-id-v1', bytes)).slice(0, 16);
  id[6] = (id[6] & 15) | 64; id[8] = (id[8] & 63) | 128;
  const hex = Array.from(id, n => n.toString(16).padStart(2, '0')).join('');
  return { id: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`, secret: btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'), bootstrapKey: crypto.randomUUID(), backup:'unconfirmed' };
}
export async function createCredential() { return fromSecret(crypto.getRandomValues(new Uint8Array(32))); }
export async function exportCode(c: Credential) { const bytes = secretBytes(c); const raw = base32(bytes) + base32(await hash('learning-code-check-v1', bytes)).slice(0,4); return 'LS1-' + raw.match(/.{8}/g)!.join('-'); }
export async function importCode(input: string) {
  const normalized = input.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, '').replace(/[a-z]/g, c => c.toUpperCase());
  if (!normalized.startsWith('LS1-')) throw new Error('INVALID_CODE');
  const raw = normalized.slice(4).replace(/-/g, '');
  if (!/^[A-Z2-7]{56}$/.test(raw)) throw new Error('INVALID_CODE');
  const bytes = decode32(raw.slice(0,52));
  if (base32(bytes) !== raw.slice(0,52) || base32(await hash('learning-code-check-v1', bytes)).slice(0,4) !== raw.slice(52)) throw new Error('INVALID_CODE');
  return fromSecret(bytes);
}
export const bearer = (c: Credential) => `Bearer ${c.id}.${c.secret}`;
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('learning-personal-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('device');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('STORAGE_UNAVAILABLE'));
    request.onblocked = () => reject(new Error('STORAGE_UNAVAILABLE'));
  });
}
export async function readCredential(): Promise<Credential | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const tx = db.transaction('device', 'readonly'); const req = tx.objectStore('device').get('owner'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('STORAGE_UNAVAILABLE')); }); }
  finally { db.close(); }
}
export async function saveCredential(c: Credential) {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('device', 'readwrite'); tx.objectStore('device').put(c, 'owner'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('STORAGE_UNAVAILABLE')); tx.onabort = () => reject(new Error('STORAGE_UNAVAILABLE')); }); }
  finally { db.close(); }
  const readback = await readCredential();
  if (readback?.secret !== c.secret || readback?.id !== c.id) throw new Error('STORAGE_UNAVAILABLE');
}

export async function forgetCredential() {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('device', 'readwrite');
      tx.objectStore('device').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('STORAGE_UNAVAILABLE'));
    });
  } finally { db.close(); }
  if (await readCredential() !== undefined) throw new Error('STORAGE_UNAVAILABLE');
  notifyDeviceForgotten();
}
