/**
 * Turns the demo's seed into SQL a hosted Supabase project can swallow in one go.
 *
 * The seed replays about a hundred days of business through the database's own functions, which
 * needs a user for every call, so it is run here against Postgres in this process (PGlite, the same
 * migrations) and the resulting rows are written out as inserts. Nothing is invented on the way
 * out: what the functions produced is what the project receives.
 *
 *   npx tsx scripts/export-hosted-seed.mts
 *
 * Writes supabase/hosted-users.sql (six sign-ins) and supabase/hosted-seed.sql (the data).
 *
 * Both schemas are exported. `restricted` holds what the money is really made of - landed costs,
 * the margin on every sale, the gain and loss on the rate - and the owner's reports are empty
 * without it. Its rows are no less real than the orders; they are simply behind another door.
 */
import { writeFileSync } from "node:fs";
import { Database, seed, PEOPLE } from "../libs/db/src/index.ts";

const DEMO_PASSWORD = "qirsh-demo";

const db = await Database.open({ seed: async (d) => seed(d) });
const pg = db.service;

// Column types decide how a value is written: a jsonb array and a uuid[] both arrive here as a
// JavaScript array and they are not written the same way.
const SCHEMAS = ["public", "restricted"];

const columns = await pg.query<{
  table_schema: string;
  table_name: string;
  column_name: string;
  udt_name: string;
  is_array: string;
  generated: string;
}>(`
  select c.table_schema, c.table_name, c.column_name, c.udt_name,
         case when c.data_type = 'ARRAY' then 'yes' else 'no' end as is_array,
         case when c.is_generated = 'ALWAYS' or c.identity_generation = 'ALWAYS' then 'yes' else 'no' end as generated
  from information_schema.columns c
  where c.table_schema = any($1)
  order by c.table_schema, c.table_name, c.ordinal_position`, [SCHEMAS]);

const typeOf = new Map<string, { udt: string; array: boolean }>();
// A column the database fills itself cannot be written to, and does not need to be: it is derived
// from the row it belongs to.
const generated = new Set<string>();
for (const c of columns.rows) {
  typeOf.set(`${c.table_schema}.${c.table_name}.${c.column_name}`, { udt: c.udt_name, array: c.is_array === "yes" });
  if (c.generated === "yes") generated.add(`${c.table_schema}.${c.table_name}.${c.column_name}`);
}

// Tables in an order that would satisfy the foreign keys even without the replica trick below.
const fks = await pg.query<{ child: string; parent: string }>(`
  select n.nspname || '.' || rel.relname as child, pn.nspname || '.' || ref.relname as parent
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_class ref on ref.oid = con.confrelid
  join pg_namespace n on n.oid = rel.relnamespace
  join pg_namespace pn on pn.oid = ref.relnamespace
  where con.contype = 'f' and n.nspname = any($1)`, [SCHEMAS]);

const tables = (
  await pg.query<{ qualified: string }>(`
    select table_schema || '.' || table_name as qualified from information_schema.tables
    where table_schema = any($1) and table_type = 'BASE TABLE' order by table_schema, table_name`, [SCHEMAS])
).rows.map((r) => r.qualified);

const exported = new Set(tables);
const parents = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
for (const { child, parent } of fks.rows) {
  // A reference to auth.users is not something this file loads, so it cannot hold a table back.
  if (child !== parent && exported.has(parent)) parents.get(child)?.add(parent);
}

const ordered: string[] = [];
const placed = new Set<string>();
while (ordered.length < tables.length) {
  const next = tables.filter((t) => !placed.has(t) && [...(parents.get(t) ?? [])].every((p) => placed.has(p)));
  const batch = next.length > 0 ? next : tables.filter((t) => !placed.has(t)); // a cycle: take what is left
  for (const t of batch) {
    ordered.push(t);
    placed.add(t);
  }
}

function literal(table: string, column: string, value: unknown): string {
  if (value === null || value === undefined) return "null";
  const type = typeOf.get(`${table}.${column}`); // table is schema-qualified
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

  if (type?.array) {
    const items = (value as unknown[]).map((v) => (v === null ? "NULL" : `"${String(v).replace(/"/g, '\\"')}"`));
    return `'{${items.join(",")}}'`;
  }
  if (type?.udt === "jsonb" || type?.udt === "json") return `${quote(JSON.stringify(value))}::jsonb`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (value instanceof Date) return quote(value.toISOString());
  return quote(String(value));
}

let rows = 0;
const parts: string[] = [
  "-- Seed data for a hosted Qirsh project. Run it after the migrations and after hosted-users.sql.",
  "-- Tables are written parents first, so the foreign keys hold as the file runs and nothing special",
  "-- is needed from the role running it. It is one transaction: it either all lands or none of it does.",
  "begin;",
  "",
];

for (const table of ordered) {
  const [schema, name] = table.split(".") as [string, string];
  const result = await pg.query<Record<string, unknown>>(`select * from ${schema}."${name}"`);
  if (result.rows.length === 0) continue;
  const cols = Object.keys(result.rows[0]!).filter((c) => !generated.has(`${table}.${c}`));
  parts.push(`-- ${table}: ${result.rows.length} rows`);
  for (let i = 0; i < result.rows.length; i += 200) {
    const chunk = result.rows.slice(i, i + 200);
    const values = chunk.map((row) => `(${cols.map((c) => literal(table, c, row[c])).join(", ")})`);
    parts.push(
      `insert into ${schema}."${name}" (${cols.map((c) => `"${c}"`).join(", ")}) values\n  ${values.join(",\n  ")}\non conflict do nothing;`,
    );
  }
  parts.push("");
  rows += result.rows.length;
}

// Identity columns were filled by the database; its counters have to be moved past what was loaded.
const identities = await pg.query<{ table_schema: string; table_name: string; column_name: string }>(`
  select table_schema, table_name, column_name from information_schema.columns
  where table_schema = any($1) and is_identity = 'YES'`, [SCHEMAS]);
for (const { table_schema, table_name, column_name } of identities.rows) {
  parts.push(
    `select setval(pg_get_serial_sequence('${table_schema}.${table_name}', '${column_name}'),` +
      ` coalesce((select max("${column_name}") from ${table_schema}.${table_name}), 1), true);`,
  );
}

parts.push("", "commit;", "");
writeFileSync("supabase/hosted-seed.sql", parts.join("\n"));

// The six people, as real sign-ins with the ids the seed used, so every row above still points at
// the right person. pgcrypto is already installed on a Supabase project.
const users = Object.values(PEOPLE)
  .map(
    (p) => `  ('00000000-0000-0000-0000-000000000000', '${p.id}', 'authenticated', 'authenticated', '${p.email}',
   extensions.crypt('${DEMO_PASSWORD}', extensions.gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"${p.name}"}'::jsonb, '', '', '', '')`,
  )
  .join(",\n");

writeFileSync(
  "supabase/hosted-users.sql",
  `-- The six people in the demo, as sign-ins on a hosted project, with the ids the seed data uses.
create extension if not exists pgcrypto with schema extensions;

-- Password for all of them: ${DEMO_PASSWORD}
-- Run this after the migrations and before hosted-seed.sql. The trigger on auth.users writes the
-- matching rows in public.profiles.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
   raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values
${users}
on conflict (id) do nothing;
`,
);

console.log(`hosted-seed.sql   ${rows} rows across ${ordered.filter(Boolean).length} tables`);
console.log(`hosted-users.sql  ${Object.keys(PEOPLE).length} sign-ins, password ${DEMO_PASSWORD}`);
