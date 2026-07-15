const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * 1024 * 1024;
const KIBIBYTE = 1024;

export const RUNTIME_RESOURCE_POLICY = Object.freeze({
  maxConcurrentAnalyses: 2,
  maxQueuedAnalyses: 16,
  queueWaitTimeoutMs: 5_000,
  analysisTimeoutMs: 5_000,
  analysisBudget: {
    maxInputBytes: 256,
    maxTradeExplorerInputBytes: 2 * KIBIBYTE,
    maxResultRows: 250,
    maxResultBytes: MEBIBYTE,
  },
  tradeExplorerRequestBodyMaxBytes: 4 * KIBIBYTE,
  anonymousSourceRateLimit: {
    capacity: 60,
    refillTokensPerSecond: 10,
    maxTrackedSources: 10_000,
    inactiveSourceRetentionMs: 15 * 60_000,
  },
  // Fly Proxy overwrites this header before requests reach the private Machine.
  trustedProxy: {
    clientAddressHeader: "fly-client-ip",
    trustedProxyHops: 0,
  },
  analysisCacheMaxBytes: 96 * MEBIBYTE,
  searchCacheMaxBytes: 16 * MEBIBYTE,
  statusMicroCacheMaxBytes: MEBIBYTE,
  cacheSafetyReserveBytes: 15 * MEBIBYTE,
  duckDbThreads: 2,
  duckDbMemoryLimit: "1GiB",
  duckDbMaxTempDirectorySize: "4GiB",
  // The retained-deployment window is exactly one current deployment
  // pairing plus two preceding compatible complete pairings (see
  // release-manifest.ts DEPLOYMENT_RETENTION_WINDOW_SIZE and issue #44).
  // `declaredServingVolumeBytes` mirrors the baseline 50-GiB volume
  // docs/production-deployment.md provisions, used as the assumed ceiling
  // when promotion cannot see the runtime's actual serving volume.
  deploymentRetention: {
    declaredServingVolumeBytes: 50 * GIBIBYTE,
    minimumFreeFraction: 0.25,
  },
} as const);
