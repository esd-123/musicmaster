"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function PlayButton({ releaseId }: { releaseId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function logPlay() {
    await fetch(`/api/releases/${releaseId}/plays`, { method: "POST" });
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={logPlay}
      disabled={isPending}
      className="shrink-0 rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
    >
      ▶ Play this record
    </button>
  );
}
