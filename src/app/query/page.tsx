"use client";

import { useState } from "react";
import Link from "next/link";
import { ReleaseCard } from "@/components/ReleaseCard";

interface Pick {
  id: number;
  title: string;
  artistNames: string[];
  year: number | null;
  coverImageUrl: string | null;
  reasoning: string;
}

export default function QueryPage() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [overallReasoning, setOverallReasoning] = useState<string | null>(null);

  async function submit() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    setPicks(null);
    setOverallReasoning(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setPicks(data.picks);
      setOverallReasoning(data.overallReasoning);
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to collection
      </Link>

      <h1 className="mt-4 mb-2 text-2xl font-semibold">Ask for a record</h1>
      <p className="mb-6 text-sm text-zinc-500">
        e.g. &ldquo;friends over, making dinner, want something fun but not too
        uptempo&rdquo;
      </p>

      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What do you feel like playing?"
          className="flex-1 rounded border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black"
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
        >
          {loading ? "Thinking…" : "Ask"}
        </button>
      </div>

      {error ? <p className="mt-6 text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {overallReasoning ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{overallReasoning}</p>
      ) : null}

      {picks && picks.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3">
          {picks.map((p) => (
            <ReleaseCard
              key={p.id}
              id={p.id}
              title={p.title}
              artistNames={p.artistNames}
              year={p.year}
              coverImageUrl={p.coverImageUrl}
              caption={p.reasoning}
            />
          ))}
        </div>
      ) : picks && picks.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">No good matches found — try rephrasing.</p>
      ) : null}
    </main>
  );
}
