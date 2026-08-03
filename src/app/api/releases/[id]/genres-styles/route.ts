import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { genresStyles, releaseGenresStyles } from "@/db/schema";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const body = await request.json();
  const name = String(body.name ?? "").trim();
  const kind = body.kind === "style" ? "style" : "genre";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  let genreStyle = await db.query.genresStyles.findFirst({
    where: and(eq(genresStyles.name, name), eq(genresStyles.kind, kind)),
  });
  if (!genreStyle) {
    // A style always belongs to exactly one genre (DB-enforced) — this route
    // has no UI path that picks one, so it only ever find-or-creates genres.
    if (kind === "style") {
      return NextResponse.json(
        { error: "Add new styles from the genre editor, where you can pick their genre" },
        { status: 400 },
      );
    }
    const [inserted] = await db.insert(genresStyles).values({ name, kind }).returning();
    genreStyle = inserted;
  }

  const existingLink = await db.query.releaseGenresStyles.findFirst({
    where: and(
      eq(releaseGenresStyles.releaseId, releaseId),
      eq(releaseGenresStyles.genreStyleId, genreStyle.id),
    ),
  });
  if (!existingLink) {
    await db.insert(releaseGenresStyles).values({ releaseId, genreStyleId: genreStyle.id });
  }

  return NextResponse.json(genreStyle);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const releaseId = Number(id);
  const body = await request.json();
  const genreStyleId = Number(body.genreStyleId);

  await db
    .delete(releaseGenresStyles)
    .where(
      and(
        eq(releaseGenresStyles.releaseId, releaseId),
        eq(releaseGenresStyles.genreStyleId, genreStyleId),
      ),
    );

  // A style that no longer applies to any release is dead weight — delete
  // it outright rather than leaving a 0-record row around (unlike a genre,
  // a style has no other rows depending on it, so this is always safe).
  let deletedStyle: { id: number; name: string } | null = null;
  const genreStyle = await db.query.genresStyles.findFirst({
    where: eq(genresStyles.id, genreStyleId),
  });
  if (genreStyle?.kind === "style") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(releaseGenresStyles)
      .where(eq(releaseGenresStyles.genreStyleId, genreStyleId));
    if (count === 0) {
      await db.delete(genresStyles).where(eq(genresStyles.id, genreStyleId));
      deletedStyle = { id: genreStyle.id, name: genreStyle.name };
    }
  }

  return NextResponse.json({ ok: true, deletedStyle });
}
