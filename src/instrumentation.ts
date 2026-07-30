export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (!process.env.DISCOGS_TOKEN || !process.env.DISCOGS_USERNAME) {
    console.warn(
      "[instrumentation] DISCOGS_TOKEN/DISCOGS_USERNAME not set — skipping scheduler startup",
    );
    return;
  }

  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
