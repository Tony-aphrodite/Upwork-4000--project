/**
 * One file to paste: the migrations in order, then the storage policies a hosted project needs for
 * proof photos. Nothing from supabase/local is included; that folder only exists so the demo can
 * pretend to be Supabase inside a browser tab.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const parts = ["-- Qirsh on a hosted Supabase project: the whole schema, in order.", "-- Run this first, then hosted-users.sql, then hosted-seed.sql.", ""];

for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
  parts.push(`-- ---------------------------------------------------------------- ${file}`);
  parts.push(readFileSync(`supabase/migrations/${file}`, "utf8").trimEnd(), "");
}
for (const file of readdirSync("supabase/production").filter((f) => f.endsWith(".sql")).sort()) {
  parts.push(`-- ---------------------------------------------------------------- production/${file}`);
  parts.push(readFileSync(`supabase/production/${file}`, "utf8").trimEnd(), "");
}

writeFileSync("supabase/hosted-install.sql", parts.join("\n"));
console.log("supabase/hosted-install.sql written");
