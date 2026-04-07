"use client";

import { FormEvent, useMemo, useState } from "react";
import type { GroundedAnswerResponse } from "@search/types/grounded-answer";

type StreamEventName = "status" | "token" | "replace" | "metadata" | "done" | "error";

interface ParsedEvent {
  name: StreamEventName;
  data: unknown;
}

function parseSseBlock(block: string): ParsedEvent | null {
  const lines = block.split("\n").map((line) => line.trim());
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) return null;

  const name = eventLine.replace("event:", "").trim() as StreamEventName;
  const dataRaw = dataLine.replace("data:", "").trim();

  try {
    return { name, data: JSON.parse(dataRaw) };
  } catch {
    return null;
  }
}

export default function Home() {
  const [query, setQuery] = useState("Qui est Jésus ?");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<GroundedAnswerResponse["metadata"] | null>(null);
  const [phase, setPhase] = useState("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => !isLoading && query.trim().length > 0, [isLoading, query]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsLoading(true);
    setPhase("retrieval");
    setAnswer("");
    setCitations([]);
    setMetadata(null);
    setError(null);

    try {
      const response = await fetch("/api/grounded-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), stream: true }),
      });

      if (!response.ok) {
        const fallback = await response.json().catch(() => ({}));
        throw new Error(fallback?.error ?? "Request failed.");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Streaming not supported by this browser.");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const parsed = parseSseBlock(block);
          if (!parsed) continue;

          if (parsed.name === "status") {
            const payload = parsed.data as { phase?: string };
            if (payload.phase === "retrieval_started") setPhase("retrieval");
            if (payload.phase === "generation_started") setPhase("generation");
          }

          if (parsed.name === "token") {
            const payload = parsed.data as { token?: string };
            if (payload.token) setAnswer((prev) => prev + payload.token);
          }

          if (parsed.name === "replace") {
            const payload = parsed.data as { answer?: string };
            if (payload.answer) setAnswer(payload.answer);
          }

          if (parsed.name === "metadata") {
            const payload = parsed.data as GroundedAnswerResponse;
            setCitations(payload.citations ?? []);
            setMetadata(payload.metadata ?? null);
          }

          if (parsed.name === "error") {
            const payload = parsed.data as { error?: string };
            setError(payload.error ?? "Stream interrupted.");
          }

          if (parsed.name === "done") {
            setPhase("done");
            setIsLoading(false);
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setError(message);
      setIsLoading(false);
      setPhase("error");
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-stone-50 to-lime-50 px-4 py-8 text-stone-900">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-stone-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Bible Grounded Assistant</h1>
        <p className="mt-2 text-sm text-stone-600">
          Streaming response mode: retrieval phase first, then token-by-token answer generation.
        </p>

        <form className="mt-5 flex gap-3" onSubmit={onSubmit}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 outline-none ring-amber-400 focus:ring"
            placeholder="Pose une question biblique"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-stone-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            {isLoading ? "Streaming..." : "Envoyer"}
          </button>
        </form>

        {isLoading && phase === "retrieval" ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="h-4 w-44 animate-pulse rounded bg-amber-200" />
            <div className="mt-2 h-4 w-full animate-pulse rounded bg-amber-100" />
            <div className="mt-2 h-4 w-10/12 animate-pulse rounded bg-amber-100" />
          </div>
        ) : null}

        <section className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-stone-600">Answer</h2>
          <p className="mt-2 whitespace-pre-wrap leading-7">{answer || "..."}</p>
        </section>

        <section className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-stone-600">Citations</h2>
          <p className="mt-2 text-sm">{citations.length ? citations.join(" | ") : "Aucune citation"}</p>
        </section>

        {metadata ? (
          <section className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
            <p>Model: {metadata.model}</p>
            <p>Prompt: {metadata.promptVersion}</p>
            <p>Source: {metadata.source}</p>
            <p>Processing: {metadata.processingTimeMs} ms</p>
          </section>
        ) : null}

        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </div>
    </main>
  );
}