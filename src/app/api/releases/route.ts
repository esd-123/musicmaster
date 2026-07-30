import { NextRequest, NextResponse } from "next/server";
import { listReleases } from "@/lib/releases";

export async function GET(request: NextRequest) {
  const genre = request.nextUrl.searchParams.get("genre") ?? undefined;
  const releases = await listReleases(genre);
  return NextResponse.json(releases);
}
