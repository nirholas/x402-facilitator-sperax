/**
 * Register (or refresh) this origin's paid resources on x402scan.
 *
 *   REGISTRAR_PRIVATE_KEY=0x... pnpm register:x402scan https://x402.sperax.io
 *
 * x402scan reads {origin}/openapi.json, probes every paid route for its 402,
 * and lists the ones that pass. The call is authenticated with Sign-In-With-X:
 * the wallet signs a login message (no funds move). Rerun it after adding or
 * changing paid routes.
 */
import { createSIWxPayload, encodeSIWxHeader } from '@x402/extensions/sign-in-with-x';
import { privateKeyToAccount } from 'viem/accounts';

const origin = process.argv[2];
const key = process.env.REGISTRAR_PRIVATE_KEY as `0x${string}` | undefined;
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
  console.error('Usage: pnpm register:x402scan https://your-origin (https, no path)');
  process.exit(1);
}
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('Set REGISTRAR_PRIVATE_KEY to the 0x-prefixed key of the wallet that signs the registration.');
  process.exit(1);
}

const signer = privateKeyToAccount(key);
const url = 'https://www.x402scan.com/api/x402/registry/register-origin';
const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin }) };

// Step 1: the unauthenticated call returns 402 with a fresh Sign-In-With-X challenge.
const challenge = await fetch(url, init);
const header = challenge.headers.get('payment-required');
const siwx = header ? JSON.parse(Buffer.from(header, 'base64').toString()).extensions?.['sign-in-with-x'] : undefined;
if (challenge.status !== 402 || !siwx) {
  console.error(`Expected a 402 Sign-In-With-X challenge, got HTTP ${challenge.status}`);
  process.exit(1);
}

// Step 2: sign the challenge for its first supported chain and retry with the proof.
const payload = await createSIWxPayload({ ...siwx.info, ...(siwx.supportedChains?.[0] ?? {}) }, signer, url);
const res = await fetch(url, { ...init, headers: { ...init.headers, 'SIGN-IN-WITH-X': encodeSIWxHeader(payload) } });
const body = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status} as ${signer.address}`);
console.log(JSON.stringify(body, null, 2));
if (!res.ok || body.success === false) process.exit(1);
