import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { USDC_ARBITRUM, USDC_BASE, USDS_ARBITRUM } from '../../src/assets.js';
import { loadConfig } from '../../src/config.js';
import { createFacilitator } from '../../src/facilitator.js';
import { createLogger } from '../../src/logger.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const PAY_TO = '0x42FfaFb149655407AAFD63628275fce64232EE21';

function build(env: Record<string, string> = {}) {
  const config = loadConfig({
    FACILITATOR_PRIVATE_KEY: KEY,
    ARBITRUM_RPC_URL: 'http://127.0.0.1:9',
    BASE_RPC_URL: 'http://127.0.0.1:9',
    DEMO_PAY_TO: PAY_TO,
    DEMO_PRICE: '0.001',
    PUBLIC_URL: 'https://x402.sperax.io',
    CONTACT_EMAIL: 'engineering@sperax.io',
    ...env,
  });
  const log = createLogger('error');
  return createApp(createFacilitator(config, log), config, log);
}

describe('x402scan discovery document', () => {
  it('has the required top-level fields', async () => {
    const doc = await (await build().request('/openapi.json')).json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
    expect(doc.info['x-guidance']).toMatch(/usds-snapshot/);
    expect(doc.info.contact).toEqual({ email: 'engineering@sperax.io' });
    expect(doc.servers).toEqual([{ url: 'https://x402.sperax.io' }]);
  });

  it('declares the paid route with x-payment-info, a 402 and an output schema', async () => {
    const doc = await (await build().request('/openapi.json')).json();
    const op = doc.paths['/demo/usds-snapshot'].get;
    expect(op['x-payment-info'].price).toEqual({ mode: 'fixed', currency: 'USD', amount: '0.001' });
    expect(op['x-payment-info'].protocols[0].x402.networks).toEqual(['eip155:42161']);
    expect(op.responses['402']).toBeDefined();
    expect(op.responses['200'].content['application/json'].schema.required).toContain('totalSupply');
    expect(op.parameters).toEqual([]);
    expect(op.security).toBeUndefined();
  });

  it('marks every free route security: [] so scanners skip it', async () => {
    const doc = await (await build().request('/openapi.json')).json();
    for (const [path, item] of Object.entries(doc.paths) as [string, { get: Record<string, unknown> }][]) {
      if (path === '/demo/usds-snapshot') continue;
      expect(item.get['x-payment-info']).toBeUndefined();
      expect(item.get.security).toEqual([]);
    }
  });

  it('omits the paid route when the demo is disabled', async () => {
    const config = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, ARBITRUM_RPC_URL: 'http://127.0.0.1:9' });
    const log = createLogger('error');
    const doc = await (await createApp(createFacilitator(config, log), config, log).request('/openapi.json')).json();
    expect(doc.paths['/demo/usds-snapshot']).toBeUndefined();
  });
});

describe('runtime 402 agrees with discovery', () => {
  async function challenge(env: Record<string, string> = {}) {
    const res = await build(env).request('/demo/usds-snapshot');
    expect(res.status).toBe(402);
    return JSON.parse(Buffer.from(res.headers.get('payment-required')!, 'base64').toString());
  }

  it('offers USDs on Arbitrum in atomic units with the bazaar extension', async () => {
    const required = await challenge();
    expect(required.accepts).toHaveLength(2);
    expect(required.accepts[1]).toMatchObject({ network: 'eip155:42161', asset: USDC_ARBITRUM.address, amount: '1000', extra: { name: 'USD Coin', version: '2' } });
    expect(required.accepts[0]).toMatchObject({
      network: 'eip155:42161',
      asset: USDS_ARBITRUM.address,
      amount: '1000000000000000',
      payTo: PAY_TO,
    });
    expect(required.extensions).toHaveProperty('bazaar');
    expect(required.extensions).toHaveProperty('erc20ApprovalGasSponsoring');
  });

  it('adds USDC on Base after USDs when Base is enabled, and says so in discovery', async () => {
    const required = await challenge({ ENABLE_BASE: 'true' });
    expect(required.accepts.map((a: { network: string }) => a.network)).toEqual(['eip155:42161', 'eip155:42161', 'eip155:8453']);
    expect(required.accepts[2]).toMatchObject({ asset: USDC_BASE.address, amount: '1000', extra: { name: 'USD Coin', version: '2' } });
    const doc = await (await build({ ENABLE_BASE: 'true' }).request('/openapi.json')).json();
    expect(doc.paths['/demo/usds-snapshot'].get['x-payment-info'].protocols[0].x402.networks).toEqual(['eip155:42161', 'eip155:8453']);
  });
});
