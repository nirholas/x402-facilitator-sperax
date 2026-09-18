import { PERMIT2_ADDRESS } from '@x402/evm';
import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from 'viem';
import { PAYMENT_ASSETS } from './assets.js';

export interface ApprovalGasPlan {
  payer: `0x${string}`;
  /** Worst-case gas cost of the approve transaction: gas limit times max fee. */
  maxCost: bigint;
  /** ETH the facilitator must send the payer first so the approve can be mined. */
  topUp: bigint;
}

/**
 * Work out how much ETH a buyer needs before their signed Permit2 `approve`
 * transaction can be broadcast.
 *
 * Under `erc20ApprovalGasSponsoring` the buyer signs the approve but holds no
 * ETH, so the facilitator funds the exact worst-case gas cost first. Only an
 * `approve(Permit2, ...)` on a registered Permit2 asset of this chain is ever
 * funded, and never above `cap`, so the sponsorship cannot be turned into a
 * general-purpose ETH faucet.
 */
export async function planApprovalGas(
  serialized: `0x${string}`,
  chainId: number,
  payerBalance: (payer: `0x${string}`) => Promise<bigint>,
  cap: bigint,
): Promise<ApprovalGasPlan> {
  const tx = parseTransaction(serialized as TransactionSerialized);
  if (tx.chainId !== chainId) {
    throw new Error(`sponsor_rejected: approve signed for chain ${tx.chainId}, expected ${chainId}`);
  }
  if (!tx.to || !tx.data) throw new Error('sponsor_rejected: approve transaction has no target or calldata');

  const asset = PAYMENT_ASSETS.find(
    (a) => a.assetTransferMethod === 'permit2' && getAddress(a.address) === getAddress(tx.to!),
  );
  if (!asset) throw new Error(`sponsor_rejected: ${tx.to} is not a Permit2 asset this facilitator sponsors`);

  const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
  if (call.functionName !== 'approve' || getAddress(call.args[0] as string) !== getAddress(PERMIT2_ADDRESS)) {
    throw new Error('sponsor_rejected: only approve(Permit2, amount) is sponsored');
  }
  if (tx.value && tx.value > 0n) throw new Error('sponsor_rejected: approve transaction must not carry value');

  const gas = tx.gas ?? 0n;
  const feeCap = tx.maxFeePerGas ?? tx.gasPrice ?? 0n;
  if (gas === 0n || feeCap === 0n) throw new Error('sponsor_rejected: approve transaction has no gas limit or fee');
  const maxCost = gas * feeCap;
  if (maxCost > cap) {
    throw new Error(`sponsor_rejected: approve could cost ${maxCost} wei, above the ${cap} wei sponsorship cap`);
  }

  const payer = await recoverTransactionAddress({ serializedTransaction: serialized as TransactionSerialized });
  const balance = await payerBalance(payer);
  return { payer, maxCost, topUp: balance >= maxCost ? 0n : maxCost - balance };
}
