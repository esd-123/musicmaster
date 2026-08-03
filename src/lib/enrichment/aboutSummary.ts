import { anthropic, QUERY_MODEL } from "@/lib/llm/client";

export interface SummarySourceMaterial {
  title: string;
  artist: string;
  year: number | null;
  genres: string[];
  styles: string[];
  discogsCommunityRating: number | null;
  discogsCommunityRatingCount: number | null;
  wikipediaSummary: string | null;
  musicbrainzTags: string | null;
  lastfmSummary: string | null;
  lastfmTags: string | null;
}

// "Prose" sources (as opposed to bare tags/ratings) are what determine
// whether we already have enough to write a real summary without needing to
// go looking for more — e.g. a well-covered mainstream release already has
// a Wikipedia or Last.fm writeup, so there's no need to spend a search on
// it. A niche release with only genre tags and no prose gets the curated
// domain-search attempt.
function hasProseSourceMaterial(m: SummarySourceMaterial): boolean {
  return Boolean(m.wikipediaSummary || m.lastfmSummary);
}

// A small, deliberately curated set of music sites — not the open web.
// Every entry is picked against a genre actually present in the collection
// (not generic padding) — see the plan/conversation history for the
// reasoning behind each one. List size doesn't affect cost (max_uses caps
// the number of actual searches, not how many domains are eligible), so
// this can grow as long as each addition is a real, relevant, text-rich
// source rather than noise.
const ALLOWED_SEARCH_DOMAINS = [
  "bandcamp.com", // independent/DIY releases
  "residentadvisor.net", // house/techno/drum & bass
  "allmusic.com", // broad editorial fallback across genres
  "allaboutjazz.com", // jazz
  "thequietus.com", // experimental/left-field/underground
  "sputnikmusic.com", // broad critic+user reviews
  "rollingstone.com", // classic rock / mainstream
  "stereogum.com", // indie/alternative
  "npr.org", // broad, strong for singer-songwriter/folk
  "nodepression.com", // country/Americana
  "okayplayer.com", // hip-hop/soul
  "waxpoetics.com", // funk/soul/hip-hop culture
  "factmag.com", // electronic/experimental, second angle alongside RA
];

function factsList(m: SummarySourceMaterial): string[] {
  return [
    `Title: ${m.title}`,
    `Artist: ${m.artist}`,
    m.year ? `Year: ${m.year}` : null,
    m.genres.length || m.styles.length
      ? `Discogs genres/styles: ${[...m.genres, ...m.styles].join(", ")}`
      : null,
    m.discogsCommunityRating
      ? `Discogs community rating: ${m.discogsCommunityRating.toFixed(1)}/5 (${m.discogsCommunityRatingCount} ratings)`
      : null,
    m.wikipediaSummary ? `Wikipedia summary: ${m.wikipediaSummary}` : null,
    m.musicbrainzTags ? `MusicBrainz tags: ${m.musicbrainzTags}` : null,
    m.lastfmSummary ? `Last.fm summary: ${m.lastfmSummary}` : null,
    m.lastfmTags ? `Last.fm tags: ${m.lastfmTags}` : null,
  ].filter((x): x is string => x !== null);
}

const SHARED_INSTRUCTIONS = `Prioritize, in roughly this order of importance: (1) the style and content of the record — what kind of music it is, what it's about; (2) its cultural significance and place in music history; (3) how it was received critically or by listeners. Skip routine production/personnel details (who produced it, engineers, studios) unless something about them is genuinely unusual or noteworthy — don't just list credits. Do not discuss vinyl pressing, packaging, or physical-edition details.

Output plain prose only, 2-4 short paragraphs. Do not add a title or heading of any kind. Do not use markdown — no asterisks, no bold, no italics, no bullet points. Just write the paragraphs directly, starting with the first sentence of content.`;

function buildPrompt(m: SummarySourceMaterial, allowSearch: boolean): string {
  const facts = factsList(m);

  if (!allowSearch) {
    return `Write a short "About this record" summary for someone who has never heard of this album, using ONLY the facts below — do not invent details, dates, personnel, or claims that aren't supported by them. If the facts are sparse, write a shorter summary rather than padding it out.

${SHARED_INSTRUCTIONS}

Facts:
${facts.join("\n")}`;
  }

  return `Write a short "About this record" summary for someone who has never heard of this album. The known facts below are sparse, so use the web_search tool to fill them out — it's restricted to a curated set of music sites: ${ALLOWED_SEARCH_DOMAINS.join(", ")}.

Search for "${m.artist} ${m.title}" and use whichever of those sites turns up real, specific information about this release. If nothing relevant turns up, don't invent anything — just write from the facts below, and it's fine for that to be short.

Only include claims grounded in the facts below or in real search results from those sites — never invent details, dates, or personnel. Be careful about artist-name collisions (a different act with a similar name) — if results don't clearly match this specific artist and release, don't use them.

${SHARED_INSTRUCTIONS}

Known facts:
${facts.join("\n")}`;
}

/**
 * Defensive cleanup in case the model doesn't fully follow the "no markdown"
 * / "no preamble" instructions — strips a leading duplicate title/heading
 * line, a leading "About this record:" lead-in, and bold/italic markers.
 */
// Even after extractText drops pre-search planning blocks, the model
// sometimes writes a short first-person reflection ("I'll proceed with what
// I've gathered", "Based on the search results...") in the same block as
// the real answer, right before it. Strip one or more leading sentences
// like that before the real content starts.
const SELF_TALK_LEADING =
  /^(let me|let's|i'll|i will|now (let me|i'll)|i now have|i have (plenty|enough|solid)|good,|here'?s what|i'?ll proceed|based on (what|the)|i don't have)[^\n]*?[.!?:]\s*/i;

function stripFormattingArtifacts(text: string): string {
  let cleaned = text
    .replace(/^\s*#{1,6}\s*.+\n+/, "") // leading markdown heading line
    .replace(/^\s*\*\*[^*\n]+\*\*\s*\n+/, "") // leading bold "heading" line
    .trim();
  for (let i = 0; i < 5 && SELF_TALK_LEADING.test(cleaned); i++) {
    cleaned = cleaned.replace(SELF_TALK_LEADING, "");
  }
  return cleaned
    .replace(/^\s*about (this|the) record:?\s*/i, "") // leading lead-in phrase
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1") // italics
    .trim();
}

const TOOL_BLOCK_TYPES = new Set(["server_tool_use", "web_search_tool_result"]);

/**
 * When the search tool is used, the model's response mixes in its own
 * planning text (written before it searches) and, once results come back,
 * splits its answer across many small citation-annotated text blocks. Only
 * the blocks written after the last tool round-trip are the real answer;
 * text before that is commentary about the search process, not content.
 * Those trailing blocks are joined with no separator (not "\n") since
 * they're fragments of one continuous flow, not separate paragraphs — any
 * paragraph breaks the model intended are already inside the block text.
 */
function extractText(content: { type: string; text?: string }[]): string | null {
  const lastToolIndex = content.reduce(
    (last, b, i) => (TOOL_BLOCK_TYPES.has(b.type) ? i : last),
    -1,
  );
  const text = content
    .slice(lastToolIndex + 1)
    .filter((b) => b.type === "text" && "text" in b)
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();
  return text ? stripFormattingArtifacts(text) : null;
}

function usedWebSearch(content: { type: string }[]): boolean {
  return content.some((b) => TOOL_BLOCK_TYPES.has(b.type));
}

/**
 * Generates the "About this record" summary. When our existing sources
 * (Wikipedia/Last.fm) already have real prose, this is a plain generation
 * call — fast and cheap. When they don't (niche/independent releases), it
 * additionally grants a web_search tool restricted to a small curated set
 * of music sites (ALLOWED_SEARCH_DOMAINS) — not the open web — since
 * that's where this kind of release is most likely to actually be
 * described. Returns null if there's nothing to say — never fabricates.
 */
export interface AboutSummaryResult {
  text: string;
  usedWebSearch: boolean;
}

export async function generateAboutSummary(
  material: SummarySourceMaterial,
): Promise<AboutSummaryResult | null> {
  const hasProse = hasProseSourceMaterial(material);

  const message = await anthropic.messages.create({
    model: QUERY_MODEL,
    // Search results (and their citation-block overhead) consume output-token
    // budget before the model writes its answer, so the search path needs
    // more headroom — too little and the model runs out of budget mid-search
    // or mid-answer, producing no (or a truncated) final answer. max_uses is
    // capped lower than before for the same reason: fewer search round-trips
    // leaves more of the budget for the actual answer.
    max_tokens: hasProse ? 700 : 6000,
    messages: [{ role: "user", content: buildPrompt(material, !hasProse) }],
    ...(hasProse
      ? {}
      : {
          tools: [
            {
              type: "web_search_20260318" as const,
              name: "web_search" as const,
              max_uses: 2,
              allowed_domains: ALLOWED_SEARCH_DOMAINS,
            },
          ],
        }),
  });

  const text = extractText(message.content);
  return text ? { text, usedWebSearch: usedWebSearch(message.content) } : null;
}
