import * as StellarSdk from "stellar-sdk";

export const STELLAR_NETWORKS = {
  TESTNET: "testnet",
  MAINNET: "mainnet",
} as const;

export type StellarNetwork =
  (typeof STELLAR_NETWORKS)[keyof typeof STELLAR_NETWORKS];

const HORIZON_URLS = {
  [STELLAR_NETWORKS.TESTNET]: "https://horizon-testnet.stellar.org",
  [STELLAR_NETWORKS.MAINNET]: "https://horizon.stellar.org",
};

const NETWORK_PASSPHRASES = {
  [STELLAR_NETWORKS.TESTNET]: StellarSdk.Networks.TESTNET,
  [STELLAR_NETWORKS.MAINNET]: StellarSdk.Networks.PUBLIC,
};

export const validateStellarNetwork = () => {
  const network = process.env.STELLAR_NETWORK;
  if (!network) {
    console.warn("⚠️  STELLAR_NETWORK not set, defaulting to testnet");
    process.env.STELLAR_NETWORK = STELLAR_NETWORKS.TESTNET;
    return;
  }

  // FIX: Change 'network as any' to 'network as StellarNetwork' or 'network as string'
  const validNetworks: string[] = Object.values(STELLAR_NETWORKS);
  if (!validNetworks.includes(network)) {
    throw new Error(
      `Invalid STELLAR_NETWORK: ${network}. Must be 'testnet' or 'mainnet'`,
    );
  }

  // Prevent accidental mainnet use in development
  if (
    network === STELLAR_NETWORKS.MAINNET &&
    process.env.NODE_ENV === "development" &&
    process.env.ALLOW_MAINNET_IN_DEV !== "true"
  ) {
    throw new Error(
      "CRITICAL: Mainnet is disabled in development mode. Set ALLOW_MAINNET_IN_DEV=true to override.",
    );
  }
};

export const logStellarNetwork = () => {
  const network = (process.env.STELLAR_NETWORK ||
    STELLAR_NETWORKS.TESTNET) as StellarNetwork;
  console.log(`[Stellar] Current Network: ${network.toUpperCase()}`);
  if (network === STELLAR_NETWORKS.MAINNET) {
    console.warn(
      "⚠️  WARNING: Using Stellar MAINNET. Real assets are being moved!",
    );
  }
};

export const getStellarServer = () => {
  const network = (process.env.STELLAR_NETWORK ||
    STELLAR_NETWORKS.TESTNET) as StellarNetwork;
  const horizonUrl = HORIZON_URLS[network];
  return new StellarSdk.Horizon.Server(horizonUrl);
};

export const getNetworkPassphrase = () => {
  const network = (process.env.STELLAR_NETWORK ||
    STELLAR_NETWORKS.TESTNET) as StellarNetwork;
  return NETWORK_PASSPHRASES[network];
};
