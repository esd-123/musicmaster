/**
 * Calls Claude once; retries once on a malformed/empty parsed_output OR a
 * thrown error (e.g. schema validation failure, transient API error).
 */
export async function parseWithRetry<T>(
  label: string,
  call: () => Promise<T | null>,
): Promise<T> {
  const attempt = async () => {
    try {
      return await call();
    } catch (err) {
      console.warn(`[llm] ${label}: attempt threw`, err);
      return null;
    }
  };

  let result = await attempt();
  if (!result) {
    console.warn(`[llm] ${label}: first attempt failed, retrying once`);
    result = await attempt();
  }
  if (!result) {
    throw new Error(`Claude did not return a parseable response for ${label} after retrying`);
  }
  return result;
}
