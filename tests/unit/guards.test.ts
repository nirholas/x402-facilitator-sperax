import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { describe, expect, it } from 'vitest';
import { USDC_ARBITRUM, USDS_ARBITRUM } from '../../src/assets.js';
import { BROKEN_PERMIT_REASON, checkBrokenPermitSponsoring } from '../../src/guards.js';

const payer = '0x1111111111111111111111111111111111111111';

function requirements(asset: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'eip155:42161',
    asset,
    amount: '1000',
    payTo: '0x2222222222222222222222222222222222222222',
    maxTimeoutSeconds: 60,
    extra: {},
  } as PaymentRequirements;
}

function payload(extensions?: Record<string, unknown>): PaymentPayload {
  return {
    x402Version: 2,
    payload: { permit2Authorization: { from: payer }, signature: '0x' },
    ...(extensions ? { extensions } : {}),
  } as unknown as PaymentPayload;
}

const allowanceOf = (value: bigint) => () => ({ readContract: async () => value }) as never;

describe('checkBrokenPermitSponsoring', () => {
  it('rejects a USDs payment that relies on an EIP-2612 permit', async () => {
    const reason = await checkBrokenPermitSponsoring(
      payload({ eip2612GasSponsoring: { info: {} } }),
      requirements(USDS_ARBITRUM.address),
      allowanceOf(0n),
    );
    expect(reason).toMatch(new RegExp(`^${BROKEN_PERMIT_REASON}`));
  });

  it('lets the payment through when the buyer already approved Permit2', async () => {
    const reason = await checkBrokenPermitSponsoring(
      payload({ eip2612GasSponsoring: { info: {} } }),
      requirements(USDS_ARBITRUM.address),
      allowanceOf(1000n),
    );
    expect(reason).toBeUndefined();
  });

  it('ignores USDs payments that use approval sponsoring', async () => {
    const reason = await checkBrokenPermitSponsoring(
      payload({ erc20ApprovalGasSponsoring: { info: {} } }),
      requirements(USDS_ARBITRUM.address),
      allowanceOf(0n),
    );
    expect(reason).toBeUndefined();
  });

  it('ignores tokens whose permit works', async () => {
    const reason = await checkBrokenPermitSponsoring(
      payload({ eip2612GasSponsoring: { info: {} } }),
      requirements(USDC_ARBITRUM.address),
      allowanceOf(0n),
    );
    expect(reason).toBeUndefined();
  });
});
