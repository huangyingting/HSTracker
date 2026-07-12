const MEBIBYTE = 1024 * 1024;

export const RUNTIME_RESOURCE_POLICY = Object.freeze({
  maxConcurrentAnalyses: 2,
  maxQueuedAnalyses: 16,
  queueWaitTimeoutMs: 5_000,
  analysisTimeoutMs: 5_000,
  analysisCacheMaxBytes: 96 * MEBIBYTE,
  searchCacheMaxBytes: 16 * MEBIBYTE,
  statusMicroCacheMaxBytes: MEBIBYTE,
  cacheSafetyReserveBytes: 15 * MEBIBYTE,
  duckDbThreads: 2,
  duckDbMemoryLimit: "1GiB",
  duckDbMaxTempDirectorySize: "4GiB",
} as const);
