import Link from "next/link";
import { QueryBox } from "@/components/QueryBox";

export default function QueryPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to collection
      </Link>
      <div className="mt-6">
        <QueryBox />
      </div>
    </main>
  );
}
