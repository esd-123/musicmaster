import { NextResponse } from "next/server";
import { getRecommendations } from "@/lib/recommendations/similarity";
import { getReleasesByIds } from "@/lib/releases";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const recs = await getRecommendations(Number(id));
  const scoreById = new Map(recs.map((r) => [r.id, r.score]));

  const releases = await getReleasesByIds(recs.map((r) => r.id));
  const results = releases.map((r) => ({ ...r, score: scoreById.get(r.id) ?? 0 }));

  return NextResponse.json(results);
}
