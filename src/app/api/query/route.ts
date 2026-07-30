import { NextResponse } from "next/server";
import { queryCollection } from "@/lib/llm/query";
import { getReleasesByIds } from "@/lib/releases";

export async function POST(request: Request) {
  const body = await request.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 503 },
    );
  }

  try {
    const result = await queryCollection(prompt);
    const reasoningById = new Map(result.picks.map((p) => [p.release_id, p.reasoning]));

    const releases = await getReleasesByIds(result.picks.map((p) => p.release_id));
    const picks = releases.map((r) => ({ ...r, reasoning: reasoningById.get(r.id) ?? "" }));

    return NextResponse.json({ picks, overallReasoning: result.overall_reasoning });
  } catch (err) {
    console.error("Query failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
