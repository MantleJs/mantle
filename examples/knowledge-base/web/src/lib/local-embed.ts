/**
 * Mirrors `knowledge-base-api`'s `localEmbedder` (same FNV-1a hash-bucket algorithm) so the
 * search box can compute a compatible query vector client-side — `/search/similar` takes a
 * raw vector, not text, and the client SDK has no server-proxy for embedding.
 *
 * This only produces meaningful results against the API's zero-key local default. If the
 * server is configured with `EMBEDDER_URL` (a real embedding model), this vector is
 * incompatible — a production frontend would call the same external embedding API, or a
 * small `/embed` proxy route, instead of duplicating the algorithm.
 */
const DIMENSIONS = 256;

function hashWord(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function localEmbed(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const words = text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  for (const word of words) {
    vector[hashWord(word) % DIMENSIONS] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}
