import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const QUERY_MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";

/** Cheaper/faster model for the first-pass shortlist query, which only
 * needs to narrow ~900 records to ~20-30 candidates, not write prose. */
export const SHORTLIST_MODEL = process.env.CLAUDE_SHORTLIST_MODEL ?? "claude-haiku-4-5-20251001";
