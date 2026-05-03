-- -----------------------------------------------------------------------------
-- Investigation Report — image URL, orientation, normalized crop (run on Supabase Postgres)
-- -----------------------------------------------------------------------------
-- Only the image URL is persisted; crop is optional JSON describing the visible
-- rectangle as fractions of natural image: { "nx", "ny", "nw", "nh" } each 0..1
-- (computed in the form from Cropper.js getData relative to natural size).
-- -----------------------------------------------------------------------------

-- Suspects: mugshot metadata (mugshot_url may already exist)
ALTER TABLE ir_suspects
  ADD COLUMN IF NOT EXISTS mugshot_orientation text CHECK (mugshot_orientation IN ('portrait', 'landscape')) DEFAULT 'portrait';

ALTER TABLE ir_suspects
  ADD COLUMN IF NOT EXISTS mugshot_crop jsonb;

COMMENT ON COLUMN ir_suspects.mugshot_orientation IS 'Preferred aspect for PDF frame: portrait vs landscape';
COMMENT ON COLUMN ir_suspects.mugshot_crop IS 'Normalized crop {nx,ny,nw,nh} on source image (0-1)';

-- Victims: photo (new)
ALTER TABLE ir_victims
  ADD COLUMN IF NOT EXISTS photo_url text;

ALTER TABLE ir_victims
  ADD COLUMN IF NOT EXISTS photo_orientation text CHECK (photo_orientation IN ('portrait', 'landscape')) DEFAULT 'portrait';

ALTER TABLE ir_victims
  ADD COLUMN IF NOT EXISTS photo_crop jsonb;

COMMENT ON COLUMN ir_victims.photo_url IS 'HTTPS URL or same-origin path to victim photo';
COMMENT ON COLUMN ir_victims.photo_orientation IS 'Portrait vs landscape PDF frame';
COMMENT ON COLUMN ir_victims.photo_crop IS 'Normalized crop {nx,ny,nw,nh}';

-- Evidences: image metadata (image_url may already exist)
ALTER TABLE ir_evidences
  ADD COLUMN IF NOT EXISTS image_orientation text CHECK (image_orientation IN ('portrait', 'landscape')) DEFAULT 'landscape';

ALTER TABLE ir_evidences
  ADD COLUMN IF NOT EXISTS image_crop jsonb;

COMMENT ON COLUMN ir_evidences.image_orientation IS 'Landscape default for exhibit frame; portrait swaps width/height';
COMMENT ON COLUMN ir_evidences.image_crop IS 'Normalized crop {nx,ny,nw,nh}';
