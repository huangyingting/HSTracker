const MEBIBYTE = 1024 * 1024;

export const RUNTIME_RESOURCE_POLICY = Object.freeze({
  maxConcurrentAnalyses: 2,
  maxQueuedAnalyses: 16,
  queueWaitTimeoutMs: 5_000,
  analysisTimeoutMs: 5_000,
  analysisBudget: {
    maxInputBytes: 256,
    maxResultRows: 250,
    maxResultBytes: MEBIBYTE,
  },
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
} as const);
