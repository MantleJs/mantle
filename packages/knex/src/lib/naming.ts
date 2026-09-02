/** Converts a camelCase entity field name to its snake_case column equivalent (userId -> user_id). */
export function toSnakeCase(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** Converts a snake_case column name to its camelCase entity field equivalent (user_id -> userId). */
export function toCamelCase(column: string): string {
  if (column.startsWith("_")) return column;
  return column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
