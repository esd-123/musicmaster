import { NextResponse } from "next/server";
import { regenerateAboutSummary } from "@/lib/enrichment/run";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const wrote = await regenerateAboutSummary(Number(id));
    return NextResponse.json({ wrote });
  } catch (err) {
    console.error(`Failed to regenerate summary for release ${id}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
