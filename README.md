# Music Master

A household tool for browsing a vinyl collection synced from Discogs, tagging/rating records, tracking play history, asking for recommendations in plain language, and viewing a "now playing" page per record.

## Features

- **Discogs sync** — daily automatic sync of your collection (`src/lib/discogs/`), plus a manual trigger at `POST /api/sync`.
- **Genre/mood/BPM organization** — genres/styles pulled from Discogs; BPM pulled from GetSongBPM (never manually entered); moods/tags are yours to add per record.
- **Enrichment** — Wikipedia, MusicBrainz, and (optionally) Last.fm summaries/tags fetched automatically after each sync (`src/lib/enrichment/`).
- **Natural-language query** (`/query`) — "friends over, want something fun but not too uptempo" → a handful of picks via Claude.
- **Now Playing page** (`/releases/[id]`) — tracklist, critical reception, your rating/notes/tags, full play history, and "if you like this, you may also like" recommendations.

## Local development

Requires Node.js 24+.

```bash
cp .env.example .env   # fill in DISCOGS_TOKEN and DISCOGS_USERNAME at minimum
npm install
npm run db:migrate     # creates ./data/app.db
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Trigger a first sync with:

```bash
curl -X POST http://localhost:3000/api/sync
```

### Environment variables

See `.env.example` for the full list. Required for core functionality:

- `DISCOGS_TOKEN`, `DISCOGS_USERNAME` — [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
- `ANTHROPIC_API_KEY` — for the `/query` natural-language feature
- `GETSONGBPM_API_KEY` — for BPM lookups ([getsongbpm.com/api](https://getsongbpm.com/api)); without it, BPM stays empty
- `LASTFM_API_KEY` — optional, adds an extra enrichment source ([last.fm/api/account/create](https://www.last.fm/api/account/create))

## Deploying on a home server (Docker)

This is the intended way to run Music Master day-to-day — one container, on a machine on your home network (NAS, Raspberry Pi, always-on Mac/PC), reachable by everyone in the house over WiFi.

```bash
cp .env.example .env   # fill in your tokens; leave DATABASE_PATH unset (see comment in the file)
docker compose up -d --build
```

This builds the image, creates a named volume (`musicmaster-data`) for the SQLite database so it survives container rebuilds, and starts the app on port 3000 — visit `http://<server-ip>:3000` from any device on your network. Migrations run automatically on container start (`scripts/migrate.mjs`).

**Note:** the Dockerfile and compose file were written and migration-tested (`scripts/migrate.mjs`, twice, against a fresh database) but not build-tested end-to-end, since this development machine doesn't have Docker installed. Run `docker compose up -d --build` on the actual target machine and check `docker compose logs -f` on first boot.

To update after pulling new code: `docker compose up -d --build` again — the data volume is untouched.

## Credits

Song BPM data powered by [GetSongBPM](https://getsongbpm.com).
