---
"@cosyte/deid": patch
---

The library now refuses an HMAC key shorter than 16 bytes (128 bits), so a caller passing a shorter key gets a new error and must use a longer random key.

What changes for a consumer:

- **The refusal.** `createDeidContext` and `createDeidRegistry` throw a `DeidError` with the new fatal code `DEID_KEY_TOO_SHORT` when the key, or an explicit `dateShiftSeed`, is shorter than 16 bytes. Before, any non-empty key was accepted. An empty key is still `DEID_NO_KEY`.
- **How it is measured.** The length is counted on the bytes the HMAC uses: a `Uint8Array` as given, a string as its UTF-8 bytes (a hex or base64 string is not decoded).
- **What to use.** 32 random bytes, for example `crypto.randomBytes(32)` or `openssl rand -hex 32`. The message says so, names the minimum, and never carries the key.
- **Linkage.** A new key gives new surrogates and new date-shift offsets, so output made under the replacement key does not link to output made under the old one.
