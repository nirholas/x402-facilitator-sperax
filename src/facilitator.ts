import { x402Facilitator } from '@x402/core/facilitator';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import {
  EIP2612_GAS_SPONSORING,
  createErc20ApprovalGasSponsoringExtension,
  type Erc20ApprovalGasSponsoringSigner,
} from '@x402/extensions';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, base } from 'viem/chains';
import { ARBITRUM_ONE, BASE } from './assets.js';
import type { FacilitatorConfig } from './config.js';
import { checkBrokenPermitSponsoring } from './guards.js';
import type { Logger } from './logger.js';
import { planApprovalGas } from './sponsor.js';

const CHAINS: Record<string, Chain> = { [ARBITRUM_ONE]: arbitrum, [BASE]: base };

export interface FacilitatorRuntime {
  facilitator: x402Facilitator;
  address: `0x${string}`;
  networks: string[];
  publicClients: Map<string, PublicClient>;
}

/** Wire one network's viem clients into the signer shape @x402/evm expects. */
function buildNetworkSigner(config: FacilitatorConfig, network: string, rpcUrl: string, log: Logger) {
  const chain = CHAINS[network];
  if (!chain) throw new Error(`Unsupported network ${network}`);
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(rpcUrl, { retryCount: 3, timeout: 20_000 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const walletClient = createWalletClient({ account, chain, transport });

  const signer = toFacilitatorEvmSigner(
    {
      address: account.address,
      getCode: ({ address }) => publicClient.getCode({ address }),
      readContract: (args) =>
        publicClient.readContract({ ...args, args: args.args ?? [] } as Parameters<PublicClient['readContract']>[0]),
      verifyTypedData: (args) =>
        publicClient.verifyTypedData(args as Parameters<PublicClient['verifyTypedData']>[0]),
      writeContract: (args) =>
        walletClient.writeContract({ ...args, chain, account } as Parameters<typeof walletClient.writeContract>[0]),
      sendTransaction: ({ to, data }) => walletClient.sendTransaction({ to, data, chain, account }),
      waitForTransactionReceipt: ({ hash, timeout }) =>
        publicClient.waitForTransactionReceipt({ hash, timeout: timeout ?? config.confirmationTimeoutMs }),
    },
    { confirmationTimeoutMs: config.confirmationTimeoutMs },
  );

  const approvalSigner: Erc20ApprovalGasSponsoringSigner = {
    ...signer,
    sendTransactions: async (transactions) => {
      const hashes: `0x${string}`[] = [];
      for (const tx of transactions) {
        if (typeof tx === 'string') await fundApprovalGas(tx);
        const hash =
          typeof tx === 'string'
            ? await walletClient.sendRawTransaction({ serializedTransaction: tx })
            : await walletClient.sendTransaction({ to: tx.to, data: tx.data, gas: tx.gas, chain, account });
        await confirm(hash);
        hashes.push(hash);
      }
      return hashes;
    },
  };

  async function confirm(hash: `0x${string}`) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: config.confirmationTimeoutMs });
    if (receipt.status !== 'success') throw new Error(`transaction_failed: ${hash}`);
  }

  /** Send the buyer exactly the ETH their signed approve needs, within the sponsorship cap. */
  async function fundApprovalGas(serialized: `0x${string}`) {
    const plan = await planApprovalGas(
      serialized,
      chain.id,
      (payer) => publicClient.getBalance({ address: payer }),
      config.maxSponsoredGasWei,
    );
    if (plan.topUp === 0n) return;
    const hash = await walletClient.sendTransaction({ to: plan.payer, value: plan.topUp, chain, account });
    await confirm(hash);
    log.info('sponsored approve gas', { network, payer: plan.payer, topUpWei: plan.topUp, transaction: hash });
  }

  return { account, publicClient, signer, approvalSigner };
}

export function createFacilitator(config: FacilitatorConfig, log: Logger): FacilitatorRuntime {
  const facilitator = new x402Facilitator();
  const publicClients = new Map<string, PublicClient>();
  const approvalSigners = new Map<string, Erc20ApprovalGasSponsoringSigner>();
  let address: `0x${string}` | undefined;

  for (const { network, rpcUrl } of config.networks) {
    const built = buildNetworkSigner(config, network, rpcUrl, log);
    address = built.account.address;
    publicClients.set(network, built.publicClient);
    approvalSigners.set(network, built.approvalSigner);
    facilitator.register(network, new ExactEvmScheme(built.signer, { simulateInSettle: true }));
  }

  const [firstNetwork] = config.networks;
  facilitator
    .registerExtension(EIP2612_GAS_SPONSORING)
    .registerExtension(
      createErc20ApprovalGasSponsoringExtension(approvalSigners.get(firstNetwork.network)!, (network) =>
        approvalSigners.get(network),
      ),
    );

  const guard = async ({ paymentPayload, requirements }: Parameters<Parameters<x402Facilitator['onBeforeVerify']>[0]>[0]) => {
    const reason = await checkBrokenPermitSponsoring(paymentPayload, requirements, (n) => publicClients.get(n));
    if (reason) {
      log.warn('payment rejected before chain interaction', { network: requirements.network, asset: requirements.asset, reason });
      return { abort: true as const, reason };
    }
    return undefined;
  };

  facilitator
    .onBeforeVerify(guard)
    .onBeforeSettle(guard)
    .onAfterVerify(async ({ requirements, result }) => {
      log.info('verify', { network: requirements.network, asset: requirements.asset, amount: requirements.amount, payer: result.payer });
    })
    .onVerifyFailure(async ({ requirements, error }) => {
      log.warn('verify failed', { network: requirements.network, asset: requirements.asset, error: error.message });
    })
    .onAfterSettle(async ({ requirements, result }) => {
      log.info('settle', {
        network: requirements.network,
        asset: requirements.asset,
        amount: requirements.amount,
        payTo: requirements.payTo,
        payer: result.payer,
        transaction: result.transaction,
        success: result.success,
      });
    })
    .onSettleFailure(async ({ requirements, error }) => {
      log.error('settle failed', { network: requirements.network, asset: requirements.asset, error: error.message });
    });

  return {
    facilitator,
    address: address!,
    networks: config.networks.map((n) => n.network),
    publicClients,
  };
}
