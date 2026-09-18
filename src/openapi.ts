/**
 * OpenAPI 3.1 discovery document, shaped for x402 registries (x402scan reads
 * `/openapi.json` first and treats the live 402 as the final word). Paid
 * operations carry `x-payment-info` and a 402 response; every free operation
 * declares `security: []` so scanners skip it instead of probing it.
 */

export const SNAPSHOT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    asset: { type: 'string', description: 'USDs contract address on Arbitrum One' },
    network: { type: 'string', description: 'CAIP-2 network id' },
    block: { type: 'string', description: 'Arbitrum One block the snapshot was read at' },
    totalSupply: { type: 'string', description: 'Total USDs supply, decimal' },
    rebasingSupply: { type: 'string', description: 'USDs held by wallets that earn auto-yield, decimal' },
    nonRebasingSupply: { type: 'string', description: 'USDs held by contracts that do not earn auto-yield, decimal' },
    rebasingShare: { type: 'number', description: 'Percent of supply earning auto-yield' },
    paused: { type: 'boolean', description: 'Whether USDs transfers are paused' },
    readAt: { type: 'string', format: 'date-time' },
  },
  required: ['asset', 'network', 'block', 'totalSupply', 'rebasingSupply', 'nonRebasingSupply', 'rebasingShare', 'paused', 'readAt'],
} as const;

export const SNAPSHOT_OUTPUT_EXAMPLE = {
  asset: '0xD74f5255D557944cf7Dd0E45FF521520002D5748',
  network: 'eip155:42161',
  block: '506338232',
  totalSupply: '511956.876697717155430723',
  rebasingSupply: '398022.305382225203556643',
  nonRebasingSupply: '113934.57131549195187408',
  rebasingShare: 77.74,
  paused: false,
  readAt: '2026-09-18T05:37:08.284Z',
};

const json = (schema: Record<string, unknown>) => ({ 'application/json': { schema } });
const free = (operationId: string, summary: string, description: string, schema: Record<string, unknown> = { type: 'object' }) => ({
  get: { operationId, summary, description, security: [], tags: ['Facilitator'], responses: { '200': { description: 'OK', content: json(schema) } } },
});

export function buildOpenApi(opts: {
  baseUrl: string;
  version: string;
  contactEmail: string | undefined;
  demo: { price: string; networks: string[] } | undefined;
}) {
  const paths: Record<string, unknown> = {
    '/supported': free('supported', 'Supported payment kinds', 'x402 v2 kinds, extensions and signer addresses this facilitator settles.'),
    '/assets': free('assets', 'Settleable assets', 'Assets this facilitator settles, with the exact requirements extra a seller must publish.'),
    '/stats': free('stats', 'USDs x402 settlement stats', 'Every USDs payment settled over x402 on Arbitrum One by any facilitator, read directly from chain.'),
    '/health': free('health', 'Liveness', 'Liveness probe.'),
  };

  if (opts.demo) {
    paths['/demo/usds-snapshot'] = {
      get: {
        operationId: 'usdsSnapshot',
        summary: 'USDs supply snapshot - live Sperax USD supply and auto-yield share on Arbitrum One',
        description:
          'Returns a live read of Sperax USD (USDs) on Arbitrum One: total supply, how much of it earns auto-yield (rebasing) versus not, the share earning yield, and whether transfers are paused. Takes no parameters.',
        tags: ['Data'],
        parameters: [],
        'x-payment-info': {
          price: { mode: 'fixed', currency: 'USD', amount: opts.demo.price },
          protocols: [{ x402: { networks: opts.demo.networks } }],
        },
        responses: {
          '200': { description: 'USDs supply snapshot', content: json(SNAPSHOT_OUTPUT_SCHEMA as unknown as Record<string, unknown>) },
          '402': { description: 'Payment Required. Pay in USDs on Arbitrum One (Permit2) or USDC on Base (EIP-3009) via x402 v2.' },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Sperax x402',
      version: opts.version,
      description:
        'x402 v2 facilitator and paid data for Sperax USD (USDs), the yield-bearing stablecoin on Arbitrum One. Agents pay per request in USDs or USDC with no account or API key.',
      'x-guidance':
        'GET /demo/usds-snapshot returns live USDs supply data for a fixed price per call; pay it with any x402 v2 client in USDs on Arbitrum One (Permit2; the first-time approval gas is sponsored) or USDC on Base. Free: GET /supported and GET /assets describe what this facilitator settles, GET /stats lists USDs x402 settlements.',
      ...(opts.contactEmail ? { contact: { email: opts.contactEmail } } : {}),
    },
    servers: [{ url: opts.baseUrl }],
    paths,
  };
}
