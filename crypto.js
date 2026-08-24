function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i])
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(String(value).replace(/\s+/g, ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', data instanceof Uint8Array ? data : new Uint8Array(data))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function fingerprintSpki(spkiB64) {
  return sha256Hex(base64ToBytes(spkiB64))
}

async function importPublicKey(spkiB64) {
  return crypto.subtle.importKey(
    'spki',
    base64ToBytes(spkiB64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt'],
  )
}

async function importPrivateKey(pkcs8B64) {
  return crypto.subtle.importKey(
    'pkcs8',
    base64ToBytes(pkcs8B64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt'],
  )
}

export async function generateUserKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const publicKeySpki = bytesToBase64(await crypto.subtle.exportKey('spki', pair.publicKey))
  return {
    keyId: crypto.randomUUID(),
    algorithm: 'rsa-oaep-sha256',
    publicKeySpki,
    fingerprint: await fingerprintSpki(publicKeySpki),
    privateKeyPkcs8: bytesToBase64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  }
}

export async function encryptFile(plaintext, recipients) {
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext)
  const rawDek = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
  const wraps = []
  for (const recipient of recipients) {
    const pub = await importPublicKey(recipient.publicKeySpki)
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawDek)
    wraps.push({
      recipient_user_id: recipient.userId,
      recipient_key_id: recipient.keyId,
      wrapped_dek: bytesToBase64(wrapped),
    })
  }
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    plaintextSha256: await sha256Hex(new Uint8Array(plaintext)),
    wraps,
  }
}

async function unwrapDek(wrappedDekB64, privateKeyPkcs8) {
  const privateKey = await importPrivateKey(privateKeyPkcs8)
  const raw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBytes(wrappedDekB64),
  )
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

export async function decryptFile(ciphertextB64, ivB64, wrappedDekB64, privateKeyPkcs8) {
  const dek = await unwrapDek(wrappedDekB64, privateKeyPkcs8)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivB64) },
    dek,
    base64ToBytes(ciphertextB64),
  )
  return bytesToBase64(plain)
}

export async function wrapDekForRecipient(wrappedDekB64, privateKeyPkcs8, recipient) {
  const dek = await unwrapDek(wrappedDekB64, privateKeyPkcs8)
  const rawDek = new Uint8Array(await crypto.subtle.exportKey('raw', dek))
  const pub = await importPublicKey(recipient.publicKeySpki)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawDek)
  return {
    recipient_user_id: recipient.userId,
    recipient_key_id: recipient.keyId,
    wrapped_dek: bytesToBase64(wrapped),
  }
}

async function deriveBackupKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function exportBackup(record, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKey = await deriveBackupKey(passphrase, salt, 210000)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    wrappingKey,
    base64ToBytes(record.privateKeyPkcs8),
  )
  return {
    v: 1,
    keyId: record.keyId,
    algorithm: record.algorithm,
    publicKeySpki: record.publicKeySpki,
    fingerprint: record.fingerprint,
    kdf: 'pbkdf2-sha256',
    iter: 210000,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  }
}

export async function importBackup(backup, passphrase) {
  const wrappingKey = await deriveBackupKey(passphrase, base64ToBytes(backup.salt), backup.iter)
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(backup.iv) },
    wrappingKey,
    base64ToBytes(backup.ciphertext),
  )
  return {
    keyId: backup.keyId,
    algorithm: backup.algorithm,
    publicKeySpki: backup.publicKeySpki,
    fingerprint: backup.fingerprint,
    privateKeyPkcs8: bytesToBase64(pkcs8),
  }
}
