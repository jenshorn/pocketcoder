import { sql } from "drizzle-orm";
import { customType, type PgColumn } from "drizzle-orm/pg-core";

// 0.7.1 stored JSON text inside jsonb strings. Only columns whose contract
// requires an object or array can safely distinguish that encoding from data.
export const structuredJson = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  codec: "jsonb",
  fromDriver: (value) => (typeof value === "string" ? JSON.parse(value) : value),
});

// SQL predicates and map updates need the same decoding as selected rows.
export function structuredJsonValue(column: PgColumn) {
  return sql`CASE WHEN jsonb_typeof(${column}) = 'string'
    THEN (${column} #>> '{}')::jsonb ELSE ${column} END`;
}
