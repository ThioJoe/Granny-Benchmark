/* Granny Bench - persistence.
   Store: localStorage with an in-memory fallback (some browsers block storage for file:// pages).
   Vault: API keys encrypted with AES-GCM using a key derived from a passphrase (PBKDF2-SHA256). */
(function (GB) {
  'use strict';
  const U = GB.U;

  const PREFIX = 'granny-bench:';
  const memory = {};
  let storageOk = true;
  try {
    const k = PREFIX + '__probe';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
  } catch (e) {
    storageOk = false;
    console.warn('[GB] localStorage unavailable - settings will only last for this session.', e);
  }

  const Store = {
    available: storageOk,
    getRaw(key) {
      if (!storageOk) return memory[key] == null ? null : memory[key];
      try { return window.localStorage.getItem(PREFIX + key); } catch (e) { return memory[key] == null ? null : memory[key]; }
    },
    setRaw(key, value) {
      if (!storageOk) { memory[key] = value; return true; }
      try {
        window.localStorage.setItem(PREFIX + key, value);
        return true;
      } catch (e) {
        console.error('[GB] Failed to save', key, e);
        const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
        U.toast(quota ? 'Browser storage is full. Export and clear old results in the Results tab.' : 'Could not save to browser storage.', 'error', 7000);
        return false;
      }
    },
    remove(key) {
      delete memory[key];
      if (storageOk) { try { window.localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ } }
    },
    get(key, fallback) {
      const raw = Store.getRaw(key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set(key, value) { return Store.setRaw(key, JSON.stringify(value)); },
  };

  // ---------------------------------------------------------------------------
  // Vault
  // ---------------------------------------------------------------------------
  const VAULT_KEY = 'vault.v1';
  const ITERATIONS = 600000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const b64 = {
    from(buf) {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    to(str) {
      const s = atob(str);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    },
  };

  const cryptoOk = !!(window.crypto && window.crypto.subtle && window.isSecureContext !== false);

  async function deriveKey(passphrase, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Secrets live in memory once unlocked. The derived CryptoKey is non-extractable,
  // so re-saving after an edit does not need the passphrase again.
  const Vault = {
    cryptoAvailable: cryptoOk,
    _key: null,
    _salt: null,
    _secrets: {},            // providerId -> api key
    _sessionOnly: {},        // keys from config import or "don't save" mode, never persisted
    events: new U.Emitter(),

    exists() { return !!Store.get(VAULT_KEY, null); },
    isUnlocked() { return !!this._key; },
    status() {
      if (!cryptoOk) return 'unavailable';
      if (this._key) return 'unlocked';
      return this.exists() ? 'locked' : 'none';
    },

    async create(passphrase) {
      if (!cryptoOk) throw new Error('Web Crypto is not available in this browser context.');
      if (!passphrase || passphrase.length < 4) throw new Error('Use a passphrase of at least 4 characters.');
      this._salt = crypto.getRandomValues(new Uint8Array(16));
      this._iter = ITERATIONS;
      this._key = await deriveKey(passphrase, this._salt, ITERATIONS);
      await this._persist();
      this.events.emit('change');
    },

    async unlock(passphrase) {
      const blob = Store.get(VAULT_KEY, null);
      if (!blob) throw new Error('No saved vault.');
      const salt = b64.to(blob.salt);
      const iter = Number(blob.iter) || ITERATIONS;
      const key = await deriveKey(passphrase, salt, iter);
      let plain;
      try {
        plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.to(blob.iv) }, key, b64.to(blob.ct));
      } catch (e) {
        throw new Error('Wrong passphrase.');
      }
      const data = JSON.parse(dec.decode(plain));
      this._key = key;
      this._salt = salt;
      this._iter = iter;
      this._secrets = (data && data.keys) || {};
      this.events.emit('change');
    },

    lock() {
      this._key = null;
      this._secrets = {};
      this.events.emit('change');
    },

    async changePassphrase(newPass) {
      if (!this._key) throw new Error('Unlock the vault first.');
      const secrets = this._secrets;
      await this.create(newPass);
      this._secrets = secrets;
      await this._persist();
    },

    destroy() {
      Store.remove(VAULT_KEY);
      this._key = null;
      this._secrets = {};
      this.events.emit('change');
    },

    async _persist() {
      if (!this._key) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this._key,
        enc.encode(JSON.stringify({ keys: this._secrets, savedAt: Date.now() })));
      Store.set(VAULT_KEY, { v: 1, kdf: 'PBKDF2-SHA256', iter: this._iter || ITERATIONS, salt: b64.from(this._salt), iv: b64.from(iv), ct: b64.from(ct) });
    },

    // Read a key: session keys (config file / memory-only) win over vault keys.
    getKey(providerId) {
      return this._sessionOnly[providerId] || this._secrets[providerId] || '';
    },
    keySource(providerId) {
      if (this._sessionOnly[providerId]) return 'session';
      if (this._secrets[providerId]) return 'vault';
      return '';
    },

    // Save a key. If the vault is unlocked it is encrypted and persisted, otherwise kept in memory only.
    async setKey(providerId, value, opts) {
      value = (value || '').trim();
      const memoryOnly = (opts && opts.memoryOnly) || !this._key;
      if (memoryOnly) {
        if (value) this._sessionOnly[providerId] = value; else delete this._sessionOnly[providerId];
      } else {
        delete this._sessionOnly[providerId];
        if (value) this._secrets[providerId] = value; else delete this._secrets[providerId];
        await this._persist();
      }
      this.events.emit('change');
    },

    setSessionKeys(map) {
      for (const id in map) if (map[id]) this._sessionOnly[id] = String(map[id]).trim();
      this.events.emit('change');
    },

    // Move memory-only keys into the (unlocked) vault.
    async adoptSessionKeys() {
      if (!this._key) return 0;
      let n = 0;
      for (const id in this._sessionOnly) { this._secrets[id] = this._sessionOnly[id]; n++; }
      this._sessionOnly = {};
      await this._persist();
      this.events.emit('change');
      return n;
    },

    allKeys() { return Object.assign({}, this._secrets, this._sessionOnly); },
  };

  GB.Store = Store;
  GB.Vault = Vault;
})(window.GB = window.GB || {});
