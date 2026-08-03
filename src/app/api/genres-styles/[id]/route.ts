import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { genresStyles } from "@/db/schema";

/**
 * Partial update for a single genre/style row: its description (freeform,
 * folded into NL-query prompts) and/or its genre membership. A style always
 * belongs to exactly one genre — `parentGenreId` must reference an existing
 * genre and can never be cleared to null on a style row (only re-pointed at
 * a different genre); a genre can never take a parent at all. These match
 * the `genres_styles_parent_kind_check` DB constraint, checked here first so
 * a mistake surfaces as a clear 400 rather than a raw SQLite error.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const genreStyleId = Number(id);
  const body = await request.json();

  const row = await db.query.genresStyles.findFirst({ where: eq(genresStyles.id, genreStyleId) });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updates: Partial<{ description: string | null; parentGenreId: number }> = {};

  if ("description" in body) {
    const description = body.description === null ? null : String(body.description).trim();
    updates.description = !description ? null : description;
  }

  if ("parentGenreId" in body) {
    if (row.kind === "genre") {
      return NextResponse.json({ error: "A genre can't have a parent genre" }, { status: 400 });
    }
    const parentGenreId = body.parentGenreId === null ? null : Number(body.parentGenreId);
    if (parentGenreId === null) {
      return NextResponse.json(
        { error: "A style must belong to a genre — move it to a different genre instead of clearing it" },
        { status: 400 },
      );
    }
    if (parentGenreId === genreStyleId) {
      return NextResponse.json({ error: "A style can't be its own parent" }, { status: 400 });
    }
    const parent = await db.query.genresStyles.findFirst({
      where: eq(genresStyles.id, parentGenreId),
    });
    if (!parent || parent.kind !== "genre") {
      return NextResponse.json({ error: "parentGenreId must reference a genre" }, { status: 400 });
    }
    updates.parentGenreId = parentGenreId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(genresStyles)
    .set(updates)
    .where(eq(genresStyles.id, genreStyleId))
    .returning();

  return NextResponse.json(updated);
}

/** Deletes a genre/style outright — cascades away any release_genres_styles
 * links. Deleting a genre that still has styles pointing at it via
 * parentGenreId fails (no onDelete action on that FK, by design — a style
 * must always belong to a genre, so it can't be silently orphaned); callers
 * must re-parent those styles first. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const genreStyleId = Number(id);

  const row = await db.query.genresStyles.findFirst({ where: eq(genresStyles.id, genreStyleId) });
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (row.kind === "genre") {
    const dependents = await db.query.genresStyles.findMany({
      where: eq(genresStyles.parentGenreId, genreStyleId),
    });
    if (dependents.length > 0) {
      return NextResponse.json(
        {
          error: `Can't delete "${row.name}" — ${dependents.length} style${
            dependents.length === 1 ? "" : "s"
          } still belong to it (${dependents.map((d) => d.name).join(", ")}). Move them to another genre first.`,
        },
        { status: 409 },
      );
    }
  }

  await db.delete(genresStyles).where(eq(genresStyles.id, genreStyleId));

  return NextResponse.json({ ok: true });
}
