import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { releaseMoodAxes } from "@/db/schema";

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const body = await request.json();

  const approachability = Number(body.approachability);
  const valence = Number(body.valence);
  const density = Number(body.density);

  if ([approachability, valence, density].some((v) => Number.isNaN(v))) {
    return NextResponse.json(
      { error: "approachability, valence, and density must all be numbers" },
      { status: 400 },
    );
  }

  const patch = {
    approachability: clamp(approachability),
    valence: clamp(valence),
    density: clamp(density),
    updatedAt: new Date().toISOString(),
  };

  const existing = await db.query.releaseMoodAxes.findFirst({
    where: eq(releaseMoodAxes.releaseId, releaseId),
  });

  if (existing) {
    await db.update(releaseMoodAxes).set(patch).where(eq(releaseMoodAxes.releaseId, releaseId));
  } else {
    await db.insert(releaseMoodAxes).values({ releaseId, ...patch });
  }

  const result = await db.query.releaseMoodAxes.findFirst({
    where: eq(releaseMoodAxes.releaseId, releaseId),
  });
  return NextResponse.json(result);
}
