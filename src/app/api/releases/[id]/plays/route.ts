import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { playEvents } from "@/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const plays = await db
    .select()
    .from(playEvents)
    .where(eq(playEvents.releaseId, releaseId))
    .orderBy(desc(playEvents.playedAt));
  return NextResponse.json(plays);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const [play] = await db.insert(playEvents).values({ releaseId }).returning();
  return NextResponse.json(play);
}
