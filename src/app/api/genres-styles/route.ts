import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { genresStyles } from "@/db/schema";

/** Creates a standalone genre/style not yet attached to any release (e.g. a
 * brand-new genre from the genre editor's "Add genre" field, or a style
 * added directly into a Kanban column) — find-or-create by (name, kind),
 * same as the release-scoped POST route. A style always belongs to exactly
 * one genre (never null; `genres_styles_parent_kind_check` enforces this at
 * the DB level), so `parentGenreId` is required when kind is "style" and
 * must name an existing genre. */
export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body.name ?? "").trim();
  const kind = body.kind === "style" ? "style" : "genre";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let parentGenreId: number | null = null;
  if (kind === "style") {
    parentGenreId = Number(body.parentGenreId);
    if (!parentGenreId) {
      return NextResponse.json(
        { error: "parentGenreId is required when creating a style" },
        { status: 400 },
      );
    }
    const parent = await db.query.genresStyles.findFirst({
      where: eq(genresStyles.id, parentGenreId),
    });
    if (!parent || parent.kind !== "genre") {
      return NextResponse.json({ error: "parentGenreId must reference a genre" }, { status: 400 });
    }
  }

  let genreStyle = await db.query.genresStyles.findFirst({
    where: and(eq(genresStyles.name, name), eq(genresStyles.kind, kind)),
  });
  if (!genreStyle) {
    const [inserted] = await db.insert(genresStyles).values({ name, kind, parentGenreId }).returning();
    genreStyle = inserted;
  } else if (kind === "style" && genreStyle.parentGenreId !== parentGenreId) {
    // Typing an existing style's name into a different column's "+ Add
    // style" field is a request to move it there, same as dragging its card
    // — not a no-op. Without this, the found-existing-row branch silently
    // returned the style unchanged under its old genre with no error,
    // making "+ Add style" appear to do nothing for any name that already
    // existed elsewhere.
    const [updated] = await db
      .update(genresStyles)
      .set({ parentGenreId })
      .where(eq(genresStyles.id, genreStyle.id))
      .returning();
    genreStyle = updated;
  }

  return NextResponse.json(genreStyle);
}
