/**
 * End-to-end: a seller prices a route in USDs, a buyer with USDs and no ETH
 * pays it through the upstream x402 client, and this facilitator verifies and
 * settles on a fork of Arbitrum One against the real USDs, Permit2 and
 * x402ExactPermit2Proxy contracts.
 *
 * Run with `pnpm test:fork`. Needs anvil (Foundry). ARBITRUM_FORK_RPC_URL
 * overrides the public RPC used as the fork source.
 */
import { serve, type ServerType } from '@hono/node-server';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { PERMIT2_ADDRESS, toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme as ExactEvmClient } from '@x402/evm/exact/client';
import { ExactEvmScheme as ExactEvmServer } from '@x402/evm/exact/server';
import {
  declareEip2612GasSponsoringExtension,
  declareErc20ApprovalGasSponsoringExtension,
} from '@x402/extensions';
import { wrapFetchWithPayment } from '@x402/fetch';
import { paymentMiddleware } from '@x402/hono';
import { Hono } from 'hono';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  erc20Abi,
  http,
  parseEther,
  parseUnits,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { ARBITRUM_ONE, USDS_ARBITRUM, usdsPrice, usdsSpendControl } from '../../src/assets.js';
import { loadConfig } from '../../src/config.js';
import { createFacilitator } from '../../src/facilitator.js';
import { createLogger } from '../../src/logger.js';
import { anvilBinary, freePort, startAnvilFork, type Anvil } from './anvil.js';

const ANVIL = anvilBinary();
const FORK_URL = process.env.ARBITRUM_FORK_RPC_URL ?? 'https://arb1.arbitrum.io/rpc';
// Anvil's first dev account, pre-funded with ETH on every fork.
const FACILITATOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// Uniswap v3 USDs/USDC 0.05% pool on Arbitrum One: the deepest USDs holder, used to fund test buyers.
const USDS_SOURCE = '0x50450351517117Cb58189edBa6bbaD6284D45902';
const USDS = USDS_ARBITRUM.address;
const PRICE = '0.25';
const PRICE_ATOMIC = parseUnits(PRICE, 18);

const usdsPermitAbi = [
  ...erc20Abi,
  {
    type: 'function',
    name: 'permit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

describe.skipIf(!ANVIL)('USDs x402 payments on an Arbitrum One fork', () => {
  let anvil: Anvil;
  let pub: PublicClient;
  let facilitatorServer: ServerType;
  let sellerServer: ServerType;
  let sellerUrl: string;
  let facilitatorUrl: string;
  const payTo = privateKeyToAccount(generatePrivateKey()).address;

  const usdsBalance = (address: `0x${string}`) =>
    pub.readContract({ address: USDS, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
  const permit2Allowance = (owner: `0x${string}`) =>
    pub.readContract({ address: USDS, abi: erc20Abi, functionName: 'allowance', args: [owner, PERMIT2_ADDRESS] });

  async function fundWithUsds(to: `0x${string}`, amount: bigint) {
    const test = createTestClient({ chain: arbitrum, mode: 'anvil', transport: http(anvil.url) });
    await test.impersonateAccount({ address: USDS_SOURCE });
    await test.setBalance({ address: USDS_SOURCE, value: parseEther('1') });
    const wallet = createWalletClient({ chain: arbitrum, transport: http(anvil.url) });
    const hash = await wallet.writeContract({
      account: USDS_SOURCE,
      address: USDS,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, amount],
    });
    await pub.waitForTransactionReceipt({ hash });
    await test.stopImpersonatingAccount({ address: USDS_SOURCE });
  }

  function buyerFetch(key: `0x${string}`) {
    const account = privateKeyToAccount(key);
    const client = new x402Client()
      .register(ARBITRUM_ONE, new ExactEvmClient(toClientEvmSigner(account, pub), { rpcUrl: anvil.url }))
      .setSpendControls({ allowedAssets: [usdsSpendControl('1')] });
    return { account, client, fetch: wrapFetchWithPayment(fetch, client) };
  }

  beforeAll(async () => {
    anvil = await startAnvilFork(ANVIL!, FORK_URL);
    pub = createPublicClient({ chain: arbitrum, transport: http(anvil.url) }) as PublicClient;

    const forkHead = await pub.getBlockNumber();
    const config = loadConfig({
      FACILITATOR_PRIVATE_KEY: FACILITATOR_KEY,
      ARBITRUM_RPC_URL: anvil.url,
      LOG_LEVEL: 'warn',
      DEMO_PAY_TO: payTo,
      DEMO_PRICE: '0.001',
      STATS_FROM_BLOCK: forkHead.toString(),
    });
    const log = createLogger('warn');
    const facilitatorApp = createApp(createFacilitator(config, log), config, log);
    const facilitatorPort = await freePort();
    facilitatorServer = serve({ fetch: facilitatorApp.fetch, port: facilitatorPort, hostname: '127.0.0.1' });
    facilitatorUrl = `http://127.0.0.1:${facilitatorPort}`;

    const resourceServer = new x402ResourceServer(
      new HTTPFacilitatorClient({ url: `http://127.0.0.1:${facilitatorPort}` }),
    ).register(ARBITRUM_ONE, new ExactEvmServer());

    const seller = new Hono();
    seller.use(
      paymentMiddleware(
        {
          'GET /premium': {
            accepts: { scheme: 'exact', network: ARBITRUM_ONE, payTo, price: usdsPrice(PRICE) },
            extensions: { ...declareErc20ApprovalGasSponsoringExtension() },
          },
          'GET /premium-via-permit': {
            accepts: {
              scheme: 'exact',
              network: ARBITRUM_ONE,
              payTo,
              price: {
                ...usdsPrice(PRICE),
                extra: { assetTransferMethod: 'permit2', name: 'Sperax USD', version: '1' },
              },
            },
            extensions: { ...declareEip2612GasSponsoringExtension() },
          },
        },
        resourceServer,
      ),
    );
    seller.get('/premium', (c) => c.json({ data: 'paid content' }));
    seller.get('/premium-via-permit', (c) => c.json({ data: 'paid content' }));
    const sellerPort = await freePort();
    sellerServer = serve({ fetch: seller.fetch, port: sellerPort, hostname: '127.0.0.1' });
    sellerUrl = `http://127.0.0.1:${sellerPort}`;
  });

  afterAll(() => {
    sellerServer?.close();
    facilitatorServer?.close();
    anvil?.stop();
  });

  it('answers an unpaid request with a USDs Permit2 offer', async () => {
    const res = await fetch(`${sellerUrl}/premium`);
    expect(res.status).toBe(402);
    const header = res.headers.get('payment-required');
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, 'base64').toString());
    expect(required.x402Version).toBe(2);
    const [offer] = required.accepts;
    expect(offer).toMatchObject({
      scheme: 'exact',
      network: ARBITRUM_ONE,
      asset: USDS,
      amount: PRICE_ATOMIC.toString(),
      payTo,
      extra: { assetTransferMethod: 'permit2' },
    });
    expect(offer.extra.name).toBeUndefined();
    expect(required.extensions).toHaveProperty('erc20ApprovalGasSponsoring');
  });

  it('settles a first USDs payment from a buyer holding no ETH, sponsoring the Permit2 approval', async () => {
    const buyer = buyerFetch(generatePrivateKey());
    await fundWithUsds(buyer.account.address, parseUnits('1', 18));
    expect(await pub.getBalance({ address: buyer.account.address })).toBe(0n);
    expect(await permit2Allowance(buyer.account.address)).toBe(0n);

    const payToBefore = await usdsBalance(payTo);
    const buyerBefore = await usdsBalance(buyer.account.address);

    const res = await buyer.fetch(`${sellerUrl}/premium`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'paid content' });

    const settle = new x402HTTPClient(buyer.client).getPaymentSettleResponse((n) => res.headers.get(n));
    expect(settle.success).toBe(true);
    expect(settle.network).toBe(ARBITRUM_ONE);
    const receipt = await pub.getTransactionReceipt({ hash: settle.transaction as `0x${string}` });
    expect(receipt.status).toBe('success');

    // USDs rebasing math truncates credits, so an EOA balance can land 1 wei under the transfer value.
    const received = (await usdsBalance(payTo)) - payToBefore;
    expect(received >= PRICE_ATOMIC - 1n && received <= PRICE_ATOMIC).toBe(true);
    const spent = buyerBefore - (await usdsBalance(buyer.account.address));
    expect(spent >= PRICE_ATOMIC - 1n && spent <= PRICE_ATOMIC + 1n).toBe(true);
    expect(await permit2Allowance(buyer.account.address)).toBeGreaterThan(0n);
  });

  it('settles a repeat payment through the existing Permit2 allowance', async () => {
    const buyer = buyerFetch(generatePrivateKey());
    await fundWithUsds(buyer.account.address, parseUnits('1', 18));

    const first = await buyer.fetch(`${sellerUrl}/premium`);
    expect(first.status).toBe(200);
    const ethAfterFirst = await pub.getBalance({ address: buyer.account.address });

    const payToBefore = await usdsBalance(payTo);
    const second = await buyer.fetch(`${sellerUrl}/premium`);
    expect(second.status).toBe(200);
    const settle = new x402HTTPClient(buyer.client).getPaymentSettleResponse((n) => second.headers.get(n));
    expect(settle.success).toBe(true);

    const received = (await usdsBalance(payTo)) - payToBefore;
    expect(received >= PRICE_ATOMIC - 1n && received <= PRICE_ATOMIC).toBe(true);
    // No second approval was needed, so the buyer's ETH did not move.
    expect(await pub.getBalance({ address: buyer.account.address })).toBe(ethAfterFirst);
  });

  it('refuses an EIP-2612 permit for USDs before spending gas, and moves no funds', async () => {
    const buyer = buyerFetch(generatePrivateKey());
    await fundWithUsds(buyer.account.address, parseUnits('1', 18));
    const buyerBefore = await usdsBalance(buyer.account.address);

    const res = await buyer.fetch(`${sellerUrl}/premium-via-permit`);
    expect(res.status).toBe(402);
    const body = JSON.stringify(await res.json().catch(() => ({})));
    const header = res.headers.get('payment-required');
    const detail = header ? Buffer.from(header, 'base64').toString() : '';
    expect(`${body} ${detail}`).toContain('eip2612_permit_nonfunctional');
    expect(await usdsBalance(buyer.account.address)).toBe(buyerBefore);
  });

  it('sells the live USDs snapshot on the demo route and indexes every settlement', async () => {
    const buyer = buyerFetch(generatePrivateKey());
    await fundWithUsds(buyer.account.address, parseUnits('1', 18));

    const unpaid = await fetch(`${facilitatorUrl}/demo/usds-snapshot`);
    expect(unpaid.status).toBe(402);

    const res = await buyer.fetch(`${facilitatorUrl}/demo/usds-snapshot`);
    expect(res.status).toBe(200);
    const snapshot = await res.json();
    expect(snapshot).toMatchObject({ asset: USDS, network: ARBITRUM_ONE, paused: false });
    expect(Number(snapshot.totalSupply)).toBeGreaterThan(0);
    const settle = new x402HTTPClient(buyer.client).getPaymentSettleResponse((n) => res.headers.get(n));
    expect(settle.success).toBe(true);

    const stats = await (await fetch(`${facilitatorUrl}/stats`)).json();
    expect(stats.settlements).toBeGreaterThanOrEqual(4);
    expect(stats.recent.map((r: { transaction: string }) => r.transaction)).toContain(settle.transaction);
    const demoRow = stats.recent.find((r: { transaction: string }) => r.transaction === settle.transaction);
    expect(demoRow).toMatchObject({ payTo, amount: parseUnits('0.001', 18).toString() });

    const page = await fetch(`${facilitatorUrl}/demo`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`${facilitatorUrl}/demo/usds-snapshot`);
  });

  it('confirms the reason: USDs permit() consumes the nonce but grants no allowance', async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const test = createTestClient({ chain: arbitrum, mode: 'anvil', transport: http(anvil.url) });
    await test.setBalance({ address: owner.address, value: parseEther('0.01') });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await owner.signTypedData({
      domain: { name: 'Sperax USD', version: '1', chainId: arbitrum.id, verifyingContract: USDS },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: { owner: owner.address, spender: PERMIT2_ADDRESS, value: PRICE_ATOMIC, nonce: 0n, deadline },
    });
    const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
    const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
    const v = Number.parseInt(signature.slice(130, 132), 16);

    const wallet = createWalletClient({ account: owner, chain: arbitrum, transport: http(anvil.url) });
    const hash = await wallet.writeContract({
      address: USDS,
      abi: usdsPermitAbi,
      functionName: 'permit',
      args: [owner.address, PERMIT2_ADDRESS, PRICE_ATOMIC, deadline, v, r, s],
    });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe('success');
    expect(await pub.readContract({ address: USDS, abi: usdsPermitAbi, functionName: 'nonces', args: [owner.address] })).toBe(1n);
    expect(await permit2Allowance(owner.address)).toBe(0n);
  });
});
