/** The fixed extension key (#49): its Chrome ID is derived from the public key, and the build puts the key in the manifest. */
import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fixed MVP extension key', () => {
  it('is an RSA public key whose derived ID matches the recorded ID, and the build embeds it', () => {
    const identity = JSON.parse(readFileSync('scripts/mvp-extension-key.json', 'utf8')), key = Buffer.from(identity.key, 'base64');
    expect(createPublicKey({ key, type: 'spki', format: 'der' }).asymmetricKeyType).toBe('rsa');
    const id = createHash('sha256').update(key).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
    expect(id).toBe(identity.id); expect(id).toMatch(/^[a-p]{32}$/);
    expect(readFileSync('scripts/build-mvp.mjs', 'utf8')).toContain('key: identity.key,');
  });
});
