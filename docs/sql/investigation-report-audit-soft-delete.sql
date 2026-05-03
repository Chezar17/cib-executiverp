-- -----------------------------------------------------------------------------
-- Investigation reports — audit & soft-delete columns (Supabase Postgres)
-- -----------------------------------------------------------------------------
-- Applies to: investigation_reports + ir_victims, ir_suspects, ir_witnesses,
--             ir_evidences, ir_debrief_entries
-- Soft delete flag name in code: is_deleted (boolean), NOT is_delete.
-- Run once; safe to re-run with IF NOT EXISTS where supported.
-- -----------------------------------------------------------------------------

-- created_at / updated_at: many projects already have these via Supabase defaults.
ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ;

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS modified_by TEXT;

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE investigation_reports
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

COMMENT ON COLUMN investigation_reports.created_by IS 'Actor who created the report (e.g. badge)';
COMMENT ON COLUMN investigation_reports.modified_at IS 'Last modification time (set by API on PUT)';
COMMENT ON COLUMN investigation_reports.modified_by IS 'Actor who last modified (set by API on PUT)';
COMMENT ON COLUMN investigation_reports.is_deleted IS 'Soft delete; true = hidden from normal lists and PDF';

-- -----------------------------------------------------------------------------
-- Child tables: ir_victims, ir_suspects, ir_witnesses, ir_evidences, ir_debrief_entries
-- Same audit + soft-delete standard as investigation_reports.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ir_victims',
    'ir_suspects',
    'ir_witnesses',
    'ir_evidences',
    'ir_debrief_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS modified_by TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by TEXT', t);
  END LOOP;
END $$;

COMMENT ON COLUMN ir_victims.is_deleted IS 'Soft delete; hidden when false filter applied';
COMMENT ON COLUMN ir_suspects.is_deleted IS 'Soft delete; hidden when false filter applied';
COMMENT ON COLUMN ir_witnesses.is_deleted IS 'Soft delete; hidden when false filter applied';
COMMENT ON COLUMN ir_evidences.is_deleted IS 'Soft delete; hidden when false filter applied';
COMMENT ON COLUMN ir_debrief_entries.is_deleted IS 'Soft delete; hidden when false filter applied';
