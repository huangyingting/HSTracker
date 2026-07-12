import {
  createReadStream as nodeCreateReadStream,
  type MakeDirectoryOptions,
  type RmOptions,
} from "node:fs";
import {
  access as nodeAccess,
  link as nodeLink,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  rename as nodeRename,
  rm as nodeRm,
  stat as nodeStat,
} from "node:fs/promises";

// Runtime-mounted release paths do not exist at build time and must not enter
// the standalone output trace.
export function accessRuntimePath(path: string) {
  return nodeAccess(/* turbopackIgnore: true */ path);
}

export function createRuntimeReadStream(path: string) {
  return nodeCreateReadStream(/* turbopackIgnore: true */ path);
}

export function linkRuntimePath(
  existingPath: string,
  newPath: string,
) {
  return nodeLink(
    /* turbopackIgnore: true */ existingPath,
    /* turbopackIgnore: true */ newPath,
  );
}

export function makeRuntimeDirectory(
  path: string,
  options?: MakeDirectoryOptions,
) {
  return nodeMkdir(/* turbopackIgnore: true */ path, options);
}

export function openRuntimePath(
  path: string,
  flags: string | number,
) {
  return nodeOpen(/* turbopackIgnore: true */ path, flags);
}

export function readRuntimeFile(path: string): Promise<Buffer>;
export function readRuntimeFile(
  path: string,
  encoding: "utf8",
): Promise<string>;
export function readRuntimeFile(
  path: string,
  encoding?: "utf8",
): Promise<Buffer | string> {
  return encoding === undefined
    ? nodeReadFile(/* turbopackIgnore: true */ path)
    : nodeReadFile(/* turbopackIgnore: true */ path, encoding);
}

export function readRuntimeDirectory(path: string) {
  return nodeReaddir(/* turbopackIgnore: true */ path, {
    withFileTypes: true,
  });
}

export function renameRuntimePath(
  oldPath: string,
  newPath: string,
) {
  return nodeRename(
    /* turbopackIgnore: true */ oldPath,
    /* turbopackIgnore: true */ newPath,
  );
}

export function removeRuntimePath(
  path: string,
  options?: RmOptions,
) {
  return nodeRm(/* turbopackIgnore: true */ path, options);
}

export function statRuntimePath(path: string) {
  return nodeStat(/* turbopackIgnore: true */ path);
}
