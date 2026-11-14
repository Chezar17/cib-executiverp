-- =============================================================================
--  NEXUS — CASE BOARD UPDATE 2: personal notifications + @mentions
--  Run ONCE in Supabase → SQL Editor → New query → paste everything → Run.
--  (Run case-board.sql first if you have not already.) Safe to run again.
-- =============================================================================

-- 1) People who were @mentioned in a case also follow its updates
ALTER TABLE public.cb_cases
  ADD COLUMN IF NOT EXISTS watchers text[] NOT NULL DEFAULT '{}';

-- 2) Personal notifications (one unread row per person per case; updates are grouped)
CREATE TABLE IF NOT EXISTS public.cb_notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_badge  text NOT NULL,
  case_id          uuid NOT NULL REFERENCES public.cb_cases(id) ON DELETE CASCADE,
  case_no          bigint,
  case_title       text,
  kind             text NOT NULL DEFAULT 'comment'
                   CHECK (kind IN ('mention','assigned','status','comment')),
  count            integer NOT NULL DEFAULT 1,
  lines            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- newest last: [{ text, at }]
  actor_name       text,
  is_read          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cb_notifications_recipient_idx
  ON public.cb_notifications (recipient_badge, is_read, updated_at DESC);

-- Only one UNREAD notification per person per case → no spam
CREATE UNIQUE INDEX IF NOT EXISTS cb_notifications_one_unread
  ON public.cb_notifications (recipient_badge, case_id) WHERE is_read = false;

ALTER TABLE public.cb_notifications ENABLE ROW LEVEL SECURITY;
