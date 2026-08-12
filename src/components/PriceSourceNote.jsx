// The small line under a PO's LP field saying where the price came from.
//
// Shared by New PO and the forecast PO modal so the two can't drift — the
// forecast modal used to resolve prices and then show nothing at all about
// them, so a buyer there had no way to tell a resolved price from a typed one.
//
// Three states, deliberately distinguishable at a glance:
//   special  — green, bold, ★. A negotiated rate; the buyer must SEE it.
//   standard — grey. The partner discount for the series.
//   no price — grey. Stated, not silent: ~9,600 items have no list price and
//              the line simply stays manual. Silence read as "it's broken".
//   cheaper  — amber second line. A rate we already hold is LOWER than the one
//              specificity picked (see findCheaperOption). Advisory only.
// An ERROR carries no note at all: a failed lookup means we do not know whether
// a price exists, and claiming "no list price" would be a lie.

export default function PriceSourceNote({ line }) {
  if (!line?._priceShort && !line?._cheaper) return null
  const special = line._priceSource && line._priceSource !== 'STANDARD'
  const moqNote = line._moq > 1 ? ` · MOQ ${line._moq}` : ''
  const note = !line._priceShort ? null : (
    <div
      title={(line._priceLabel || line._priceShort) + moqNote}
      style={{
        fontSize: 10, marginTop: 2, lineHeight: 1.2, whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
        color: special ? 'var(--green-text)' : 'var(--gray-400)',
        fontWeight: special ? 'var(--fw-semibold)' : 'var(--fw-regular)',
      }}
    >
      {special ? '★ ' : ''}{line._priceShort}{moqNote}
    </div>
  )

  if (!line._cheaper) return note
  return (
    <>
      {note}
      {/* Advisory only. Specificity still decides the price — this says a rate
          we already hold is lower, which usually means a vendor's quantity
          scale was recorded incompletely. Amber, not red: nothing is wrong,
          there is just a better option to consider. */}
      <div title={line._cheaper}
        style={{ fontSize: 10, marginTop: 2, lineHeight: 1.2, whiteSpace: 'nowrap',
                 overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                 color: 'var(--amber-text)', fontWeight: 'var(--fw-medium)' }}>
        ⚠ {line._cheaper}
      </div>
    </>
  )
}
