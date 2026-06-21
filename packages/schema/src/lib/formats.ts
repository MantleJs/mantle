import { FormatRegistry } from "@sinclair/typebox/type";

// Register common JSON Schema formats so Value.Check validates them correctly.
// TypeBox 0.34 returns false for any format not present in the FormatRegistry.

FormatRegistry.Set("email", (value) =>
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value),
);

FormatRegistry.Set("date-time", (value) => !isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value));

FormatRegistry.Set("date", (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)));

FormatRegistry.Set(
  "uuid",
  (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
);

FormatRegistry.Set("uri", (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
});

FormatRegistry.Set("ipv4", (value) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split(".").every((n) => Number(n) <= 255));

FormatRegistry.Set("ipv6", (value) => /^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i.test(value));
