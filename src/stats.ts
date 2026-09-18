import { x402ExactPermit2ProxyAddress } from '@x402/evm';
import { decodeEventLog, erc20Abi, formatUnits, getAddress, type Log, type PublicClient } from 'viem';
import { USDS_ARBITRUM } from './assets.js';
import type { Logger } from './logger.js';

export interface Settlement {
  transaction: `0x${string}`;
  block: string;
  payer: `0x${string}`;
  payTo: `0x${string}`;
  amount: string;
  amountFormatted: string;
}

export interface SettlementStats {
  asset: string;
  network: string;
  source: string;
  fromBlock: string;
  scannedToBlock: string;
  settlements: number;
  volume: string;
  volumeFormatted: string;
  uniquePayers: number;
  uniquePayees: number;
  recent: Settlement[];
  updatedAt: string | null;
}

const RECENT_LIMIT = 20;
const MAX_CHUNK = 200_000n;
const MIN_CHUNK = 1_000n;

/**
 * Every USDs payment settled over x402, read straight from Arbitrum One.
 *
 * The x402 Permit2 proxy emits a data-less `Settled` event per payment, so the
 * index finds those transactions and reads the USDs `Transfer` inside each
 * one. That covers payments settled by any facilitator, not just this one,
 * and needs no database: state rebuilds from the chain after a restart.
 */
export class SettlementIndex {
  private scannedTo: bigint;
  private readonly seen = new Set<string>();
  private readonly payers = new Set<string>();
  private readonly payees = new Set<string>();
  private volume = 0n;
  private recent: Settlement[] = [];
  private updatedAt: Date | null = null;
  private chunk = MAX_CHUNK;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly client: PublicClient,
    private readonly fromBlock: bigint,
    private readonly log: Logger,
  ) {
    this.scannedTo = fromBlock - 1n;
  }

  /** Scan any new blocks. Concurrent callers share one in-flight scan. */
  refresh(): Promise<void> {
    this.refreshing ??= this.scan().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  snapshot(): SettlementStats {
    return {
      asset: USDS_ARBITRUM.address,
      network: USDS_ARBITRUM.network,
      source: `USDs Transfer events in transactions that emit Settled from ${x402ExactPermit2ProxyAddress}`,
      fromBlock: this.fromBlock.toString(),
      scannedToBlock: this.scannedTo.toString(),
      settlements: this.seen.size,
      volume: this.volume.toString(),
      volumeFormatted: formatUnits(this.volume, USDS_ARBITRUM.decimals),
      uniquePayers: this.payers.size,
      uniquePayees: this.payees.size,
      recent: this.recent,
      updatedAt: this.updatedAt?.toISOString() ?? null,
    };
  }

  private async scan() {
    const head = await this.client.getBlockNumber();
    while (this.scannedTo < head) {
      const from = this.scannedTo + 1n;
      const to = from + this.chunk - 1n > head ? head : from + this.chunk - 1n;
      let logs: Log[];
      try {
        logs = await this.client.getLogs({ address: x402ExactPermit2ProxyAddress, fromBlock: from, toBlock: to });
      } catch (err) {
        if (this.chunk <= MIN_CHUNK) throw err;
        this.chunk /= 4n;
        continue;
      }
      const txs = [...new Set(logs.map((l) => l.transactionHash).filter((h): h is `0x${string}` => !!h))];
      for (const hash of txs) await this.ingest(hash);
      this.scannedTo = to;
    }
    this.updatedAt = new Date();
  }

  private async ingest(hash: `0x${string}`) {
    if (this.seen.has(hash)) return;
    const receipt = await this.client.getTransactionReceipt({ hash });
    if (receipt.status !== 'success') return;
    const usds = getAddress(USDS_ARBITRUM.address);
    for (const entry of receipt.logs) {
      if (getAddress(entry.address) !== usds) continue;
      let decoded;
      try {
        decoded = decodeEventLog({ abi: erc20Abi, data: entry.data, topics: entry.topics });
      } catch {
        continue;
      }
      if (decoded.eventName !== 'Transfer') continue;
      const { from, to, value } = decoded.args;
      this.seen.add(hash);
      this.payers.add(from);
      this.payees.add(to);
      this.volume += value;
      this.recent = [
        {
          transaction: hash,
          block: receipt.blockNumber.toString(),
          payer: from,
          payTo: to,
          amount: value.toString(),
          amountFormatted: formatUnits(value, USDS_ARBITRUM.decimals),
        },
        ...this.recent,
      ].slice(0, RECENT_LIMIT);
      this.log.info('indexed usds x402 settlement', { transaction: hash, amount: value });
      return;
    }
  }
}
