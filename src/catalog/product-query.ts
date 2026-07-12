export function isSuppressedProductQuery(query: string): boolean {
  return [...query].length < 2;
}
