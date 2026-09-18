import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { PERMIT2_ADDRESS, erc20AllowanceAbi } from '@x402/evm';
import { EIP2612_GAS_SPONSORING } from '@x402/extensions';
import type { PublicClient } from 'viem';
import { findAsset } from './assets.js';

export const BROKEN_PERMIT_REASON = 'eip2612_permit_nonfunctional';

type AllowanceReader = Pick<PublicClient, 'readContract'>;

function permit2Payer(payload: PaymentPayload): `0x${string}` | undefined {
  const auth = (payload.payload as { permit2Authorization?: { from?: unknown } }).permit2Authorization;
  return typeof auth?.from === 'string' ? (auth.from as `0x${string}`) : undefined;
}

/**
 * Refuse a Permit2 payment that relies on an EIP-2612 permit for a token
 * whose `permit()` never grants an allowance.
 *
 * The x402 Permit2 proxy calls `permit()` inside try/catch, so the failure is
 * silent and the settlement reverts later with "Insufficient allowance" after
 * the facilitator has already paid gas. Rejecting at verify time gives the
 * buyer an actionable reason instead. A buyer who already approved Permit2 is
 * let through, because the permit is then irrelevant.
 *
 * Returns the abort reason, or undefined when the payment may proceed.
 */
export async function checkBrokenPermitSponsoring(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  clientFor: (network: string) => AllowanceReader | undefined,
): Promise<string | undefined> {
  const asset = findAsset(requirements.network, requirements.asset);
  if (!asset || asset.eip2612PermitFunctional) return undefined;
  if (!payload.extensions?.[EIP2612_GAS_SPONSORING.key]) return undefined;

  const payer = permit2Payer(payload);
  const client = clientFor(requirements.network);
  if (payer && client) {
    const allowance = (await client.readContract({
      address: asset.address,
      abi: erc20AllowanceAbi,
      functionName: 'allowance',
      args: [payer, PERMIT2_ADDRESS],
    })) as bigint;
    if (allowance >= BigInt(requirements.amount)) return undefined;
  }

  return (
    `${BROKEN_PERMIT_REASON}: ${asset.symbol} permit() does not set an allowance. ` +
    `Approve Permit2 (${PERMIT2_ADDRESS}) with a transaction, or pay with the ` +
    `erc20ApprovalGasSponsoring extension by omitting extra.name and extra.version.`
  );
}
