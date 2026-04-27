// Investigation Report case number: 00001, 00002, … (zero-padded width 5)
const WIDTH = 5

export function formatIrCaseNumber(n) {
  return String(Math.max(0, Math.floor(n))).padStart(WIDTH, '0')
}

/** Parse a stored case_number to its numeric part (handles "00001", "IR-12", etc.). */
export function parseCaseNumberString(s) {
  if (s == null || s === '') return 0
  const t = String(s).trim()
  const asInt = parseInt(t, 10)
  if (!Number.isNaN(asInt) && asInt >= 0) return asInt
  const matches = t.match(/\d+/g)
  if (!matches || !matches.length) return 0
  return Math.max(...matches.map((x) => parseInt(x, 10) || 0))
}

/**
 * Next number after max across all rows (including soft-deleted) to avoid reusing
 * a number after delete.
 */
export async function getNextCaseNumber(supabase) {
  const { data, error } = await supabase
    .from('investigation_reports')
    .select('case_number')

  if (error) throw new Error(error.message)
  let max = 0
  for (const r of data || []) {
    max = Math.max(max, parseCaseNumberString(r.case_number))
  }
  return formatIrCaseNumber(max + 1)
}
