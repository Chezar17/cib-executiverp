-- =============================================================================
-- NMAIL: file attachments (Supabase Storage + nx_mail_messages.attachments)
-- Run in Supabase SQL editor after creating bucket (section 3).
-- =============================================================================

-- 1) Table column: metadata only (path inside private bucket, not a public URL)
ALTER TABLE public.nx_mail_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.nx_mail_messages
  DROP CONSTRAINT IF EXISTS nx_mail_messages_attachments_is_array;

ALTER TABLE public.nx_mail_messages
  ADD CONSTRAINT nx_mail_messages_attachments_is_array
  CHECK (jsonb_typeof(attachments) = 'array');

COMMENT ON COLUMN public.nx_mail_messages.attachments IS
  'NMAIL attachments: [{ "path"?, "legacy_url"?, "filename", "mime", "size_bytes" }]; path = object key in bucket nmail-attachments';

-- 2) Legacy rows without attachments: API still merges image_urls / image_url when attachments is []
-- Optional one-off backfill (customize if your columns are TEXT[] vs jsonb):
--
-- INSERT INTO migrations_log VALUES ('manual', 'Convert image_urls to attachments legacy_url');


-- 3) Storage bucket (private); uploads go through POST /api/nexus-mail multipart (field `file`, service role).
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
ON CONFLICT (id) DO NOTHING;

-- RLS: with service-role-only API access you usually need no Storage policies here.
-- If you enable client uploads later, add explicit INSERT policies scoped by folder.


-- 4) OPTIONAL — extend nx_mail_inbox_agg so inbox previews show "[Attachment]"
-- Include in the RETURNS TABLE something like last_attachment_count bigint.
-- Populate it from the latest message row, e.g.:
--   coalesce(jsonb_array_length(coalesce(last_msg.attachments, '[]'::jsonb)), 0)::bigint
-- Until then, previews may omit attachment-only last messages (API fills body-only snippets).
