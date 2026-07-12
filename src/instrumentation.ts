export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { ensureApplicationRuntimeStarted } = await import(
    "./runtime/runtime-startup"
  );
  await ensureApplicationRuntimeStarted();
}
