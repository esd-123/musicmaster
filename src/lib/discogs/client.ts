import { USER_AGENT } from "@/lib/userAgent";

const DISCOGS_API_BASE = "https://api.discogs.com";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DiscogsError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "DiscogsError";
  }
}

const MAX_429_RETRIES = 1;

/**
 * Rate-limit-aware fetch wrapper for the Discogs API. Discogs allows 60
 * authenticated requests/min; when the remaining-request header gets low we
 * back off before issuing the next request instead of waiting for a 429.
 */
export async function discogsFetch<T>(
  path: string,
  token: string,
  retriesLeft = MAX_429_RETRIES,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${DISCOGS_API_BASE}${path}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Discogs token=${token}`,
      "User-Agent": USER_AGENT,
    },
  });

  const remaining = Number(res.headers.get("X-Discogs-Ratelimit-Remaining"));
  if (!res.ok) {
    if (res.status === 429 && retriesLeft > 0) {
      // Hit the limit despite backoff — wait a full window and retry, up to
      // MAX_429_RETRIES times, rather than recursing indefinitely if the
      // limit stays hit (sustained outage, misconfigured token, etc).
      await sleep(60_000);
      return discogsFetch<T>(path, token, retriesLeft - 1);
    }
    throw new DiscogsError(`Discogs API ${res.status} for ${url}`, res.status);
  }

  // Back off proactively once we're down to a handful of remaining requests.
  if (Number.isFinite(remaining) && remaining <= 3) {
    await sleep(2_000);
  }

  return res.json() as Promise<T>;
}
