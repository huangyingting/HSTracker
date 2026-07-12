export function currentUtcSecond(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}
