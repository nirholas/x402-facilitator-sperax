import { describe, expect, it } from 'vitest';
import {
  USDC_ARBITRUM,
  USDS_ARBITRUM,
  findAsset,
  priceIn,
  requirementsExtra,
  toAtomicAmount,
  usdsPrice,
  usdsSpendControl,
} from '../../src/assets.js';

describe('toAtomicAmount', () => {
  it('converts decimals exactly, with no floating point drift', () => {
    expect(toAtomicAmount('0.1', 18)).toBe('100000000000000000');
    expect(toAtomicAmount('$0.01', 6)).toBe('10000');
    expect(toAtomicAmount('1234.567890123456789012', 18)).toBe('1234567890123456789012');
  });

  it('rejects malformed, zero and over-precise amounts', () => {
    expect(() => toAtomicAmount('abc', 6)).toThrow(/Invalid amount/);
    expect(() => toAtomicAmount('-1', 6)).toThrow(/Invalid amount/);
    expect(() => toAtomicAmount('0', 6)).toThrow(/greater than zero/);
    expect(() => toAtomicAmount('0.0000001', 6)).toThrow(/decimal places/);
  });
});

describe('asset registry', () => {
  it('finds assets case-insensitively and per network', () => {
    expect(findAsset('eip155:42161', USDS_ARBITRUM.address.toLowerCase())).toBe(USDS_ARBITRUM);
    expect(findAsset('eip155:8453', USDS_ARBITRUM.address)).toBeUndefined();
    expect(findAsset('eip155:42161', 'not-an-address')).toBeUndefined();
  });

  it('omits the EIP-712 domain for USDs so clients use approval sponsoring', () => {
    expect(requirementsExtra(USDS_ARBITRUM)).toEqual({ assetTransferMethod: 'permit2' });
  });

  it('includes the EIP-712 domain for EIP-3009 USDC', () => {
    expect(requirementsExtra(USDC_ARBITRUM)).toEqual({ name: 'USD Coin', version: '2' });
  });

  it('prices a route in USDs with 18-decimal atomic units', () => {
    expect(usdsPrice('0.25')).toEqual({
      amount: '250000000000000000',
      asset: USDS_ARBITRUM.address,
      extra: { assetTransferMethod: 'permit2' },
    });
    expect(priceIn(USDC_ARBITRUM, '1').amount).toBe('1000000');
  });

  it('builds a buyer spend control with an atomic cap', () => {
    expect(usdsSpendControl('2')).toEqual({
      network: 'eip155:42161',
      asset: USDS_ARBITRUM.address,
      maxAmountPerPayment: '2000000000000000000',
    });
  });
});
