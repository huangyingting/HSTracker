export function matchesIfNoneMatch(
  ifNoneMatch: string | null,
  representationEtag: string,
): boolean {
  if (ifNoneMatch === null) {
    return false;
  }
  if (ifNoneMatch.trim() === "*") {
    return true;
  }

  const target = /^(?:W\/)?"([^"]*)"$/u.exec(representationEtag)?.[1];
  return (
    target !== undefined &&
    [
      ...ifNoneMatch.matchAll(
        /(?:^|,)\s*(?:W\/)?"([^"]*)"\s*(?=,|$)/gu,
      ),
    ].some((match) => match[1] === target)
  );
}
