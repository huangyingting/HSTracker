export function isSuppressedProductQuery(query: string): boolean {
  const characters = [...query];
  // Reviewed single-Han aliases are precise enough to search without a broad scan.
  return (
    characters.length < 2 &&
    !characters.some((character) => /\p{Script=Han}/u.test(character))
  );
}
