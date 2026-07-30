import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userReleaseData } from "@/db/schema";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const body = await request.json();

  const rating =
    body.rating === null || body.rating === undefined ? undefined : Number(body.rating);
  const notes = typeof body.notes === "string" ? body.notes : undefined;

  if (rating !== undefined && (rating < 1 || rating > 5)) {
    return NextResponse.json({ error: "rating must be 1-5" }, { status: 400 });
  }

  const existing = await db.query.userReleaseData.findFirst({
    where: eq(userReleaseData.releaseId, releaseId),
  });

  const patch = {
    ...(rating !== undefined ? { rating } : {}),
    ...(notes !== undefined ? { notes } : {}),
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db
      .update(userReleaseData)
      .set(patch)
      .where(eq(userReleaseData.releaseId, releaseId));
  } else {
    await db.insert(userReleaseData).values({ releaseId, ...patch });
  }

  const result = await db.query.userReleaseData.findFirst({
    where: eq(userReleaseData.releaseId, releaseId),
  });
  return NextResponse.json(result);
}
