import { NextRequest, NextResponse } from "next/server";
import { runEnrichment } from "@/lib/enrichment/run";

export async function POST(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  const releaseIdsParam = request.nextUrl.searchParams.get("releaseIds");
  const releaseIds = releaseIdsParam
    ? releaseIdsParam.split(",").map((s) => Number(s.trim()))
    : undefined;

  try {
    const result = await runEnrichment(limit, releaseIds);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Enrichment run failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
