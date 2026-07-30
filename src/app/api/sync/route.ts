import { NextResponse } from "next/server";
import { syncDiscogsCollection } from "@/lib/discogs/sync";

export async function POST() {
  try {
    const result = await syncDiscogsCollection();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Discogs sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
