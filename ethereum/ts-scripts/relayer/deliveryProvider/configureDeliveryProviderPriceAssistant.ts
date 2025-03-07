import {
  init,
  ChainInfo,
  loadScriptConfig,
  getDeliveryProvider,
  getOperatingChains,
} from "../helpers/env";
import { buildOverrides } from "../helpers/deployments";

import type { DeliveryProvider } from "../../../ethers-contracts/DeliveryProvider";
import { ChainId } from "@wormhole-foundation/sdk"

type PricingWalletAction = {
  shouldUpdate: boolean;
  address: string;
  chainId: ChainId;
}

interface Config {
  priceAssistantAddress: PricingWalletConfig[];
}

interface PricingWalletConfig {
  chainId: ChainId;
  address: string;
}

// extended wait is required for some chains like Unichain.
const WAIT_BLOCKS = 4;

const processName = "configureDeliveryProviderPriceAssistant";
init();
const operatingChains = getOperatingChains();
const config: Config = loadScriptConfig(processName);

async function run() {
  console.log(`Start! ${processName}`);
  
  const updateTasks = operatingChains.map((chain) =>
    updateDeliveryProviderConfiguration(config, chain));

  const results = await Promise.allSettled(updateTasks);
  for (const result of results) {
    if (result.status === "rejected") {
      console.log(
        `Updates processing failed: ${result.reason?.stack || result.reason}`
      );
    } else {
      // Print update details; this reflects the exact updates requested to the contract.
      // Note that we assume that this update element was added because
      // some modification was requested to the contract.
      // This depends on the behaviour of the process functions.

      printUpdate(result.value);
    }
  }
}

function printUpdate(update: PricingWalletAction) {
  let messages = [
    `Updates for operating chain ${update.chainId}:`,
  ];
  messages.push(`  Should've updated: ${update.shouldUpdate}`);
  messages.push(`  Pricing Address: ${update.address}`);

  console.log(messages.join("\n"));
}

async function updateDeliveryProviderConfiguration(config: Config, chain: ChainInfo) {
  const deliveryProvider = await getDeliveryProvider(chain);

  const pricingWalletConfig = config.priceAssistantAddress.find(
    (element) => element.chainId === chain.chainId
  );

  if (!pricingWalletConfig) {
    throw new Error(
      `Failed to find price assistant address for chain ${chain.chainId}`
    );
  }

  console.log(
    `Processing price assistant address update on chain ${pricingWalletConfig.chainId}`
  );

  const update = await processPricingWalletUpdate(deliveryProvider, pricingWalletConfig);

  if (update.shouldUpdate) {
    const overrides = await buildOverrides(
      () => deliveryProvider.estimateGas.updatePricingWallet(update.address),
      chain
    );
  
    let receipt;
    try {
      const tx = await deliveryProvider.updatePricingWallet(
        update.address,
        overrides
      );
      receipt = await tx.wait(WAIT_BLOCKS); 
    } catch (error) {
      console.log(
        `Update failed on operating chain ${chain.chainId}. Error: ${error}`
      );
      throw error;
    }
  
    if (receipt.status !== 1) {
      throw new Error(
        `Update failed on operating chain ${chain.chainId}. Tx id ${receipt.transactionHash}`
      );
    } 
  }

  return update;
}

async function processPricingWalletUpdate(
  deliveryProvider: DeliveryProvider,
  { address, chainId }: PricingWalletConfig
) {
  const currentPricingWallet = await deliveryProvider.pricingWallet();
  const shouldUpdate = currentPricingWallet.toLowerCase() !== address.toLowerCase();
  
  return { shouldUpdate, address, chainId };
}

run().then(() => console.log(`Done! ${processName}`));
