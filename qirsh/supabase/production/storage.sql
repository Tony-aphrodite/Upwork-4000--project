-- Storage for payment screenshots and branding, applied to the hosted project with the
-- migrations. Private buckets; the path starts with the tenant id, and the policies mirror the
-- receipts table: the owner sees all of their environment's proofs, an adviser only her own
-- customers' proofs, nobody else anything.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
       ('branding', 'branding', false, 2097152, array['image/png', 'image/svg+xml', 'image/jpeg'])
on conflict (id) do nothing;

-- Running this twice is harmless: the policies are replaced, the buckets are left alone.
drop policy if exists "proofs: upload into own environment" on storage.objects;
drop policy if exists "proofs: read what the receipt allows" on storage.objects;
drop policy if exists "branding: read own environment" on storage.objects;
drop policy if exists "branding: owner writes" on storage.objects;

-- object name: <tenant_id>/<receipt_id>.jpg (the bucket is not part of the name, and
-- receipts.proof_path holds exactly this string)
create policy "proofs: upload into own environment" on storage.objects for insert to authenticated
with check (
  bucket_id = 'proofs'
  and (storage.foldername(name))[1] = private.tenant_id()::text
  and private.has_role('owner', 'adviser')
);

create policy "proofs: read what the receipt allows" on storage.objects for select to authenticated
using (
  bucket_id = 'proofs'
  and (storage.foldername(name))[1] = private.tenant_id()::text
  and (
    private.has_role('owner')
    or exists (select 1 from public.receipts r where r.proof_path = storage.objects.name and private.sees_customer(r.customer_id))
    -- an adviser may read back what she just uploaded, before the receipt row exists
    or (private.has_role('adviser') and owner = auth.uid())
  )
);
-- No update or delete policy: a proof, like the receipt it belongs to, is never replaced.

create policy "branding: read own environment" on storage.objects for select to authenticated
using (bucket_id = 'branding' and (storage.foldername(name))[1] = private.tenant_id()::text);
create policy "branding: owner writes" on storage.objects for insert to authenticated
with check (bucket_id = 'branding' and (storage.foldername(name))[1] = private.tenant_id()::text and private.has_role('owner'));
