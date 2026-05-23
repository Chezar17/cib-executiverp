-- =============================================================================
-- NMAIL attachments — FOLLOW-UP migration (safe after nexus-mail-attachments.sql)
-- Run once in Supabase SQL editor when the first migration is already applied.
-- All statements are intended to be idempotent or guarded with IF EXISTS / IF NOT EXISTS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Indexes (messages that carry attachment metadata — helps analytics & scans)
-- -----------------------------------------------------------------------------

-- Note: Avoid jsonb_array_length() in INDEX … WHERE predicates (often STABLE, not IMMUTABLE).

CREATE INDEX IF NOT EXISTS ix_nx_mail_messages_thread_has_attachments
  ON public.nx_mail_messages (thread_id)
  WHERE attachments IS NOT NULL AND attachments <> '[]'::jsonb;

CREATE INDEX IF NOT EXISTS ix_nx_mail_messages_attachments_gin
  ON public.nx_mail_messages
  USING gin (attachments jsonb_path_ops);


-- -----------------------------------------------------------------------------
-- B) Refresh bucket limits / MIME whitelist if bucket existed from an older INSERT
--    (Supabase matches on buckets.id)
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'nmail-attachments',
  'nmail-attachments',
  false,
  12582912,
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp','application/pdf',
    'text/plain','text/csv','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip','video/mp4','audio/mpeg','audio/mp3'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- -----------------------------------------------------------------------------
-- C) OPTIONAL backfill: copy legacy image_urls / image_url into attachments
--    Only rows where attachments is still [].
--    Pick ONE variant that matches your column types; comment out the other.
-- -----------------------------------------------------------------------------

-- --- Variant C1: image_urls is JSON/JSONB array of URL strings ----------------
/*
UPDATE public.nx_mail_messages m
SET attachments = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'legacy_url', trim(both '"' from elem::text),
        'filename',
          left(
            coalesce(
              nullif(
                split_part(reverse(split_part(reverse(trim(both '"' from elem::text)), '?', 1)), '/', 1),
                ''
              ),
              'attachment'
            ),
            260
          ),
        'mime', 'image/jpeg',
        'size_bytes', 0
      )
      ORDER BY ord
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements_text(
    CASE
      WHEN m.image_urls IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(m.image_urls) = 'array' THEN m.image_urls::jsonb
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS t(elem, ord)
)
WHERE (m.attachments IS NULL OR m.attachments = '[]'::jsonb)
  AND m.image_urls IS NOT NULL
  AND jsonb_array_length(
    CASE
      WHEN jsonb_typeof(m.image_urls) = 'array' THEN m.image_urls::jsonb
      ELSE '[]'::jsonb
    END
  ) > 0;
*/

-- --- Variant C2: image_urls column type is text[] -----------------------------
/*
UPDATE public.nx_mail_messages m
SET attachments = (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'legacy_url', u,
        'filename',
          left(
            coalesce(
              nullif(split_part(reverse(split_part(reverse(u), '?', 1)), '/', 1), ''),
              'attachment'
            ),
            260
          ),
        'mime', 'image/jpeg',
        'size_bytes', 0
      )
      ORDER BY n
    ),
    '[]'::jsonb
  )
  FROM unnest(m.image_urls) WITH ORDINALITY AS uu(u, n)
)
WHERE (m.attachments IS NULL OR m.attachments = '[]'::jsonb)
  AND m.image_urls IS NOT NULL
  AND cardinality(m.image_urls) > 0;
*/

-- --- Variant C3: only legacy image_url (single), attachments still empty -------
/*
UPDATE public.nx_mail_messages m
SET attachments = jsonb_build_array(
  jsonb_build_object(
    'legacy_url', trim(both '"' from m.image_url::text),
    'filename', 'attachment',
    'mime', 'image/jpeg',
    'size_bytes', 0
  )
)
WHERE (m.attachments IS NULL OR m.attachments = '[]'::jsonb)
  AND m.image_url IS NOT NULL
  AND length(trim(both '"' from m.image_url::text)) > 0;
*/

-- -----------------------------------------------------------------------------
-- D) OPTIONAL: ANALYZE after large backfill
-- -----------------------------------------------------------------------------

-- ANALYZE public.nx_mail_messages;
