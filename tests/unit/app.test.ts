import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createFacilitator } from '../../src/facilitator.js';
import { createLogger } from '../../src/logger.js';

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function build(env: Record<string, string> = {}) {
  const config = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, ARBITRUM_RPC_URL: 'http://127.0.0.1:9', ...env });
  const log = createLogger('error');
  return createApp(createFacilitator(config, log), config, log);
}

const post = (path: string, body: unknown) =>
  build().request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('config', () => {
  it('requires a valid private key', () => {
    expect(() => loadConfig({})).toThrow(/FACILITATOR_PRIVATE_KEY/);
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: '0x1234' })).toThrow(/32-byte/);
  });

  it('enables Arbitrum by default and Base on request', () => {
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY }).networks.map((n) => n.network)).toEqual(['eip155:42161']);
    expect(loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, ENABLE_BASE: 'true' }).networks.map((n) => n.network)).toEqual([
      'eip155:42161',
      'eip155:8453',
    ]);
  });

  it('refuses a configuration with no networks', () => {
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, ENABLE_ARBITRUM: 'false' })).toThrow(/at least one network/);
  });
});

describe('HTTP API', () => {
  it('advertises exact on Arbitrum with both gas sponsoring extensions', async () => {
    const res = await build().request('/supported');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kinds).toContainEqual(expect.objectContaining({ x402Version: 2, scheme: 'exact', network: 'eip155:42161' }));
    expect(body.extensions).toEqual(expect.arrayContaining(['eip2612GasSponsoring', 'erc20ApprovalGasSponsoring']));
  });

  it('lists the assets a seller can price in, with the extra to publish', async () => {
    const body = await (await build().request('/assets')).json();
    const usds = body.assets.find((a: { symbol: string }) => a.symbol === 'USDs');
    expect(usds).toMatchObject({
      network: 'eip155:42161',
      decimals: 18,
      assetTransferMethod: 'permit2',
      eip2612PermitFunctional: false,
      requirementsExtra: { assetTransferMethod: 'permit2' },
      gasSponsoring: ['erc20ApprovalGasSponsoring'],
    });
    expect(body.assets.some((a: { network: string }) => a.network === 'eip155:8453')).toBe(false);
  });

  it('reports degraded readiness when the RPC is unreachable', async () => {
    const res = await build().request('/ready');
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('degraded');
  });

  it('rejects malformed verify and settle requests with a reason', async () => {
    const verify = await post('/verify', { paymentPayload: {} });
    expect(verify.status).toBe(400);
    expect((await verify.json()).invalidReason).toMatch(/^invalid_request/);

    const settle = await build().request('/settle', { method: 'POST', body: 'not json' });
    expect(settle.status).toBe(400);
    expect((await settle.json()).errorReason).toMatch(/^invalid_json/);
  });

  it('rejects networks this facilitator does not serve', async () => {
    const res = await post('/verify', {
      paymentPayload: { x402Version: 2, payload: {} },
      paymentRequirements: { scheme: 'exact', network: 'eip155:1', asset: '0x0', amount: '1', payTo: '0x0' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).invalidReason).toMatch(/^unsupported_scheme_or_network/);
  });
});

describe('RPC failover config', () => {
  it('accepts a comma-separated list of RPC URLs in priority order', () => {
    const config = loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, ARBITRUM_RPC_URL: 'https://a.example/rpc, https://b.example/rpc' });
    expect(config.networks[0].rpcUrls).toEqual(['https://a.example/rpc', 'https://b.example/rpc']);
  });

  it('rejects a list containing an invalid URL', () => {
    expect(() => loadConfig({ FACILITATOR_PRIVATE_KEY: KEY, ARBITRUM_RPC_URL: 'https://a.example/rpc,not-a-url' })).toThrow(/ARBITRUM_RPC_URL/);
  });
});
