/**
 * Pay for an x402 route with USDs on Arbitrum One.
 *
 *   BUYER_PRIVATE_KEY=0x... RESOURCE_URL=http://localhost:4021/quote pnpm example:buyer
 *
 * This spends real USDs. The wallet needs USDs and no ETH: the facilitator
 * sponsors the one-time Permit2 approval. MAX_USDS caps any single payment
 * (default 0.10).
 */
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum } from 'viem/chains';
import { ARBITRUM_ONE, usdsSpendControl } from '../src/assets.js';

const key = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
const url = process.env.RESOURCE_URL ?? 'http://localhost:4021/quote';
const rpcUrl = process.env.ARBITRUM_RPC_URL ?? 'https://arb1.arbitrum.io/rpc';

if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error('Set BUYER_PRIVATE_KEY to the 0x-prefixed key of a wallet holding USDs on Arbitrum One.');
  process.exit(1);
}

const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: arbitrum, transport: http(rpcUrl) });
const client = new x402Client()
  .register(ARBITRUM_ONE, new ExactEvmScheme(toClientEvmSigner(account, publicClient), { rpcUrl }))
  .setSpendControls({ allowedAssets: [usdsSpendControl(process.env.MAX_USDS ?? '0.10')] });

const res = await wrapFetchWithPayment(fetch, client)(url);
console.log(`HTTP ${res.status}`, await res.text());
if (res.ok) {
  const settle = new x402HTTPClient(client).getPaymentSettleResponse((name) => res.headers.get(name));
  console.log(`Settled on ${settle.network}: https://arbiscan.io/tx/${settle.transaction}`);
}
