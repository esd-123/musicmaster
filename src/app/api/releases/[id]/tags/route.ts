import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tags, releaseTags } from "@/db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const body = await request.json();
  const label = String(body.label ?? "").trim();
  const kind = body.kind === "mood" ? "mood" : "tag";

  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  let tag = await db.query.tags.findFirst({
    where: and(eq(tags.label, label), eq(tags.kind, kind)),
  });
  if (!tag) {
    const [inserted] = await db.insert(tags).values({ label, kind }).returning();
    tag = inserted;
  }

  const existingLink = await db.query.releaseTags.findFirst({
    where: and(eq(releaseTags.releaseId, releaseId), eq(releaseTags.tagId, tag.id)),
  });
  if (!existingLink) {
    await db.insert(releaseTags).values({ releaseId, tagId: tag.id });
  }

  return NextResponse.json(tag);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const body = await request.json();
  const tagId = Number(body.tagId);

  await db
    .delete(releaseTags)
    .where(and(eq(releaseTags.releaseId, releaseId), eq(releaseTags.tagId, tagId)));

  return NextResponse.json({ ok: true });
}
