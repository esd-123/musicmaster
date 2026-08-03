import { NextResponse } from "next/server";
import { buildCollectionCatalog } from "@/lib/llm/catalog";

/**
 * Full-collection mood-axis payload for the mood editor and mood cube pages.
 * Drops `summary` (About Record prose) — neither view needs it, and it's
 * the one field worth keeping off this otherwise-cheap response.
 */
export async function GET() {
  const catalog = await buildCollectionCatalog();
  const entries = catalog.map((entry) => ({
    id: entry.id,
    artist: entry.artist,
    title: entry.title,
    year: entry.year,
    genres: entry.genres,
    tags: entry.tags,
    moods: entry.moods,
    rating: entry.rating,
    moodAxes: entry.moodAxes,
  }));
  return NextResponse.json(entries);
}
