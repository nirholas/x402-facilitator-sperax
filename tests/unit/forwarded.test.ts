import { describe, expect, it } from 'vitest';
import { withForwardedProto } from '../../src/forwarded.js';

describe('withForwardedProto', () => {
  it('rewrites the scheme when the proxy terminated TLS', () => {
    const req = new Request('http://x402.sperax.io/demo/usds-snapshot?a=1', { headers: { 'x-forwarded-proto': 'https' } });
    expect(withForwardedProto(req).url).toBe('https://x402.sperax.io/demo/usds-snapshot?a=1');
  });

  it('keeps POST bodies intact', async () => {
    const req = new Request('http://x402.sperax.io/verify', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https', 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
    const out = withForwardedProto(req);
    expect(out.url).toBe('https://x402.sperax.io/verify');
    expect(await out.json()).toEqual({ ok: true });
  });

  it('leaves direct and already-https requests alone', () => {
    const plain = new Request('http://127.0.0.1:3402/health');
    expect(withForwardedProto(plain)).toBe(plain);
    const tls = new Request('https://x402.sperax.io/health', { headers: { 'x-forwarded-proto': 'https' } });
    expect(withForwardedProto(tls)).toBe(tls);
  });
});
