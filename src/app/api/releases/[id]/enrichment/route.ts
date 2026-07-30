import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { enrichmentCache } from "@/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(enrichmentCache)
    .where(eq(enrichmentCache.releaseId, Number(id)));
  return NextResponse.json(rows);
}
