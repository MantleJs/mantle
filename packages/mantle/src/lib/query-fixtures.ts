/**
 * Shared conformance fixture for nested-path + `$contains` querying (D-7).
 *
 * Adapters that support dot-path field names and the `$contains` operator run
 * these cases in their specs so every implementation agrees on semantics.
 * `@mantlejs/memory` is the executable reference: it seeds
 * `NESTED_QUERY_RECORDS` and asserts each case returns `expectedIds`.
 * Translator-style adapters (e.g. `@mantlejs/supabase`, which is specced
 * against a mocked client) feed each case's `where` through their translator
 * and assert the emitted backend calls.
 *
 * Semantics (mirrors PostgreSQL jsonb `@>` containment):
 * - Dot-path keys (`"metadata.owner.name"`) address nested fields.
 * - `$contains` with an array operand: the field array contains every element.
 * - `$contains` with a scalar operand: the field array contains that element.
 * - `$contains` with an object operand: the field object is a superset
 *   (recursively) of the operand.
 */

export interface NestedQueryRecord extends Record<string, unknown> {
  id: string;
  name: string;
  tags: string[];
  metadata: {
    level: number;
    tags: string[];
    owner: { name: string };
  };
}

export const NESTED_QUERY_RECORDS: NestedQueryRecord[] = [
  {
    id: "1",
    name: "alpha",
    tags: ["red", "blue"],
    metadata: { level: 3, tags: ["a", "b"], owner: { name: "alice" } },
  },
  {
    id: "2",
    name: "beta",
    tags: ["blue"],
    metadata: { level: 7, tags: ["b"], owner: { name: "bob" } },
  },
  {
    id: "3",
    name: "gamma",
    tags: [],
    metadata: { level: 5, tags: ["a"], owner: { name: "alice" } },
  },
];

export interface NestedQueryCase {
  name: string;
  where: Record<string, unknown>;
  /** Ids from `NESTED_QUERY_RECORDS` the where clause must match, in id order. */
  expectedIds: string[];
}

export const NESTED_QUERY_CASES: NestedQueryCase[] = [
  {
    name: "dot-path equality",
    where: { "metadata.owner.name": "alice" },
    expectedIds: ["1", "3"],
  },
  {
    name: "dot-path comparison operator",
    where: { "metadata.level": { $gt: 4 } },
    expectedIds: ["2", "3"],
  },
  {
    name: "$contains scalar element on a top-level array",
    where: { tags: { $contains: "blue" } },
    expectedIds: ["1", "2"],
  },
  {
    name: "$contains array operand (all elements required)",
    where: { tags: { $contains: ["red", "blue"] } },
    expectedIds: ["1"],
  },
  {
    name: "$contains on a dot-path array",
    where: { "metadata.tags": { $contains: "a" } },
    expectedIds: ["1", "3"],
  },
  {
    name: "$contains object operand (JSON superset)",
    where: { metadata: { $contains: { owner: { name: "alice" } } } },
    expectedIds: ["1", "3"],
  },
];
