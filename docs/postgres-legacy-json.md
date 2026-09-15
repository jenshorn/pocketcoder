# Upgrading databases written by 0.7.1

The 0.7.1 Bun SQL writer could store serialized JSON inside a PostgreSQL jsonb
string. Its reader decoded that extra layer. The Drizzle store introduced in
0.7.2 stopped decoding it, so existing templates could prevent server startup
with `Invalid input: expected object, received string`.

Structured JSON columns now decode that legacy layer on read. This covers
template specs, workspace snapshots and object fields, storage references and
mount lists, checkpoint snapshots and manifests, conversation metadata, and
warm-pool provider references. Metadata filters and output-map appends also
decode the stored value before applying PostgreSQL JSON operators.

New writes use ordinary JSON objects and arrays. There is no schema migration
or bulk rewrite; reads do not change stored records. Updating a structured
field writes its normal JSON representation.

Arbitrary JSON values in individual outputs and outbox payloads retain their
existing representation. A JSON string in those fields can be legitimate data,
even when it looks like JSON. Without knowing which writer produced a value,
decoding it would risk changing its meaning. This fix does not reinterpret
historical scalar output or arbitrary event payload values.

Regression tests use the former writer's `JSON.stringify(value)` jsonb
parameter convention against PostgreSQL, then read through the public store.
They cover startup template loading, workspace reads and metadata filtering,
output-map updates, scalar string preservation, and checkpoint/storage reads.
