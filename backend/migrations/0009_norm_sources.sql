-- AquaScheme: norm registry source tracking (norms base, PDFs in docs/norms).
-- Apply AFTER 0008. Idempotent: safe to re-run.
-- A clause may now record which official PDF and which PDF page its wording
-- was transcribed from. verify_page marks OCR doubt: digits must be re-checked
-- against the PDF by eye before the value is trusted.

alter table public.norm_documents add column if not exists source_file text;
alter table public.norm_documents add column if not exists note text;

alter table public.norm_clauses add column if not exists source_file text;
alter table public.norm_clauses add column if not exists source_page integer;
alter table public.norm_clauses add column if not exists verify_page boolean not null default false;
