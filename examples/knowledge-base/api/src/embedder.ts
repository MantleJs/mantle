import { GeneralError } from "@mantlejs/mantle";

export interface Embedder {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/** FNV-1a — deterministic, dependency-free, good enough to bucket words into a fixed-width vector. */
function hashWord(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Zero-key local default: a deterministic hash-based bag-of-words vector, L2-normalized so
 * cosine/inner-product distance behaves sanely. Demo-quality by design — swap in `httpEmbedder`
 * (or your own `Embedder`) for real semantic search.
 */
export function localEmbedder(dimensions = 256): Embedder {
  return {
    dimensions,
    async embed(text: string): Promise<number[]> {
      const vector = new Array<number>(dimensions).fill(0);
      const words = text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
      for (const word of words) {
        vector[hashWord(word) % dimensions] += 1;
      }
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
      return Promise.resolve(vector.map((v) => v / norm));
    },
  };
}

/** Delegates to an HTTP embedding endpoint: `POST { text } -> { vector: number[] }`. */
export function httpEmbedder(url: string, dimensions: number): Embedder {
  return {
    dimensions,
    async embed(text: string): Promise<number[]> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        throw new GeneralError(`Embedder request to ${url} failed with status ${response.status}`);
      }
      const body = (await response.json()) as { vector: number[] };
      return body.vector;
    },
  };
}

/** `EMBEDDER_URL` selects the HTTP-backed implementation; otherwise the local default. */
export function createEmbedder(): Embedder {
  const dimensions = Number(process.env.EMBEDDER_DIMENSIONS ?? 256);
  return process.env.EMBEDDER_URL ? httpEmbedder(process.env.EMBEDDER_URL, dimensions) : localEmbedder(dimensions);
}
