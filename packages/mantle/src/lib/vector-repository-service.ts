import type { ServiceParams, VectorRepository } from "./types.js";
import { BadRequest } from "./errors.js";
import { RepositoryService, type RepositoryServiceOptions } from "./repository-service.js";

export interface VectorRepositoryServiceOptions extends RepositoryServiceOptions {
  /** Bounds for `similar()`'s topK. When set, a missing topK gets `default` and requests are capped at `max`. */
  topK?: { default: number; max: number };
}

/** Request body for the `similar` custom method. */
export interface SimilarData {
  /** The query embedding. Length must match the repository's vector space. */
  vector: number[];
  /** How many neighbours to return. @default 10 (or `options.topK.default`) */
  topK?: number;
  /** Optional metadata filter, same operator syntax as `find()`'s where. */
  where?: Record<string, unknown>;
}

const DEFAULT_TOP_K = 10;

/**
 * A `RepositoryService<T>` over a `VectorRepository<T>` that ships the `similar` custom
 * method pre-wired to `repository.findSimilar()`. Register it with the method listed so
 * transports expose it (custom methods dispatch as `POST /<path>/similar`):
 *
 * ```typescript
 * app.use("docs", new VectorRepositoryService(new DocRepository(app)), {
 *   methods: ["find", "get", "create", "update", "patch", "remove", "similar"],
 * });
 * ```
 *
 * Every result carries the adapter's native match metric as `_score` — see the adapter
 * README for whether higher or lower means "more similar".
 */
export class VectorRepositoryService<T extends Record<string, unknown>, D = Partial<T>> extends RepositoryService<
  T,
  D
> {
  constructor(
    protected override readonly repository: VectorRepository<T, D>,
    protected override readonly options: VectorRepositoryServiceOptions = {},
  ) {
    super(repository, options);
  }

  async similar(data: SimilarData, _params?: ServiceParams): Promise<Array<T & { _score: number }>> {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new BadRequest(
        "similar expects a body object.",
        undefined,
        undefined,
        'POST { "vector": number[], "topK"?: number, "where"?: {...} } to this method.',
      );
    }

    const { vector, where } = data;
    if (!Array.isArray(vector) || vector.length === 0 || !vector.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new BadRequest(
        "similar requires 'vector' as a non-empty array of finite numbers.",
        undefined,
        undefined,
        "Pass the query embedding, e.g. { vector: [0.12, -0.5, …] } — its length must match the index's dimensionality.",
      );
    }

    let topK = data.topK ?? this.options.topK?.default ?? DEFAULT_TOP_K;
    if (!Number.isInteger(topK) || topK < 1) {
      throw new BadRequest(`topK must be a positive integer, got '${String(data.topK)}'`);
    }
    if (this.options.topK) {
      topK = Math.min(topK, this.options.topK.max);
    }

    if (where !== undefined) {
      if (where === null || typeof where !== "object" || Array.isArray(where)) {
        throw new BadRequest("where must be an object of field filters");
      }
      this.assertFields(where);
    }

    return this.repository.findSimilar(vector, topK, where !== undefined ? { where } : undefined);
  }
}
