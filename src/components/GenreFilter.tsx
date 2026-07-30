"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function GenreFilter({ options }: { options: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("genre") ?? "";

  return (
    <select
      value={current}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value ? `/?genre=${encodeURIComponent(value)}` : "/");
      }}
      className="rounded border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-black"
    >
      <option value="">All genres &amp; styles</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
