import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { genresStyles, releaseGenresStyles } from "@/db/schema";

/**
 * Collapses one genre/style into another: every release carrying `fromId`
 * gets linked to the "to" genre/style (creating it if it doesn't exist yet,
 * so this doubles as a rename when `toName` isn't an existing entry) and the
 * `fromId` row is deleted, cascading away its now-redundant links.
 *
 * A style always belongs to exactly one genre, so two cases need extra care
 * here beyond the release-tag move: creating a brand-new style target (no
 * existing row matched `toName`) must give it a genre immediately — it
 * inherits `from`'s genre, since renaming a style shouldn't require
 * re-choosing one. And merging genre A into genre B must re-parent any
 * styles still pointing at A before A is deleted, or the delete fails (no
 * `onDelete` action on that FK — see schema.ts).
 */
export async function POST(request: Request) {
  const body = await request.json();
  const fromId = Number(body.fromId);
  const toName = String(body.toName ?? "").trim();
  const toKind = body.toKind === "style" ? "style" : "genre";

  if (!fromId || !toName) {
    return NextResponse.json({ error: "fromId and toName are required" }, { status: 400 });
  }

  const from = await db.query.genresStyles.findFirst({ where: eq(genresStyles.id, fromId) });
  if (!from) {
    return NextResponse.json({ error: "Source genre/style not found" }, { status: 404 });
  }

  if (toKind === "style" && from.kind !== "style") {
    return NextResponse.json(
      { error: "A genre can't be merged into a style — styles must belong to a genre" },
      { status: 400 },
    );
  }

  let to = await db.query.genresStyles.findFirst({
    where: and(eq(genresStyles.name, toName), eq(genresStyles.kind, toKind)),
  });
  if (!to) {
    const [inserted] = await db
      .insert(genresStyles)
      .values(
        toKind === "style"
          ? { name: toName, kind: toKind, parentGenreId: from.parentGenreId }
          : { name: toName, kind: toKind },
      )
      .returning();
    to = inserted;
  }

  if (to.id === from.id) {
    return NextResponse.json({ error: "Source and target are the same" }, { status: 400 });
  }

  if (from.kind === "genre") {
    // `from` is about to be deleted — any style still pinned to it needs a
    // new genre first, or the delete below fails on the FK.
    await db
      .update(genresStyles)
      .set({ parentGenreId: to.id })
      .where(eq(genresStyles.parentGenreId, from.id));
  }

  const movedRows = await db
    .select({ releaseId: releaseGenresStyles.releaseId })
    .from(releaseGenresStyles)
    .where(eq(releaseGenresStyles.genreStyleId, from.id));
  const movedReleaseIds = movedRows.map((r) => r.releaseId);

  if (movedReleaseIds.length > 0) {
    await db
      .insert(releaseGenresStyles)
      .values(movedReleaseIds.map((releaseId) => ({ releaseId, genreStyleId: to!.id })))
      .onConflictDoNothing();
  }

  // Cascades away the now-stale release_genres_styles rows for `from`.
  await db.delete(genresStyles).where(eq(genresStyles.id, from.id));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(releaseGenresStyles)
    .where(eq(releaseGenresStyles.genreStyleId, to.id));

  return NextResponse.json({
    to: {
      id: to.id,
      name: to.name,
      kind: to.kind,
      description: to.description,
      parentGenreId: to.parentGenreId,
    },
    toReleaseCount: count,
    movedReleaseIds,
  });
}
