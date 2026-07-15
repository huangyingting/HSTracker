import { statfsSync } from "node:fs";

// The injectable seam the deployment retention headroom gate uses to learn
// how much space a serving volume actually has. Production uses
// `statfsFilesystemCapacityProbe`; tests substitute a deterministic
// function instead of depending on real filesystem state (see issue #44
// "injectable/local-substitutable filesystem capacity seam").
export type FilesystemCapacity = Readonly<{
  totalBytes: number;
  freeBytes: number;
}>;

export type FilesystemCapacityProbe = (path: string) => FilesystemCapacity;

export const statfsFilesystemCapacityProbe: FilesystemCapacityProbe = (
  path,
) => {
  const result = statfsSync(path, { bigint: true });
  const blockSize = Number(result.bsize);
  const totalBytes = Number(result.blocks) * blockSize;
  const freeBytes = Number(result.bavail) * blockSize;
  if (
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(freeBytes) ||
    totalBytes <= 0
  ) {
    throw new Error(
      `The serving volume at ${path} reported no usable filesystem capacity.`,
    );
  }
  return { totalBytes, freeBytes };
};
