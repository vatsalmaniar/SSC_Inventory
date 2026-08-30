import { useState, useEffect, useRef, useCallback } from 'react'

export default function Typeahead({ value, onChange, onSelect, placeholder, fetchFn, renderItem, disabled, strictSelect, separator }) {
  const [open, setOpen]       = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [dropStyle, setDropStyle] = useState({})
  const [query, setQuery]     = useState(value || '')
  const timerRef              = useRef(null)
  // Debouncing cancels pending TIMERS, not requests already in flight. Two can
  // overlap, and setResults ran for whichever REPLIED last rather than whichever
  // was typed last: a slow answer for "MAD14" could overwrite the correct answer
  // for "MAD1401030", leaving the box and the list disagreeing. Each request
  // takes a ticket; a stale one is discarded.
  const seqRef                = useRef(0)
  const wrapRef               = useRef(null)
  const inputRef              = useRef(null)

  // Keep query in sync when parent sets a value externally (e.g. auto-fill from CO)
  useEffect(() => {
    if (strictSelect) setQuery(value || '')
  }, [value, strictSelect])

  useEffect(() => {
    function onClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const calcPosition = useCallback(() => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }, [])

  async function handleChange(e) {
    const v = e.target.value
    if (strictSelect) {
      setQuery(v)
      if (!v.trim()) { seqRef.current++; onChange(''); setResults([]); setOpen(false); setLoading(false); return }
    } else {
      onChange(v)
      if (!v.trim()) { seqRef.current++; setResults([]); setOpen(false); setLoading(false); return }
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const seq = ++seqRef.current
      setLoading(true)
      const data = await fetchFn(v)
      // A newer keystroke (or a selection) has superseded this request — drop
      // it. Whatever superseded it owns the results and the loading flag.
      if (seq !== seqRef.current) return
      setResults(data)
      calcPosition()
      setOpen(true)
      setLoading(false)
    }, 250)
  }

  function handleBlur() {
    if (!strictSelect) return
    // Delay lets onMouseDown on dropdown item fire first
    setTimeout(() => setQuery(value || ''), 200)
  }

  function select(item) {
    // Invalidate anything in flight, or a late reply reopens the dropdown after
    // the user has already picked.
    seqRef.current++
    clearTimeout(timerRef.current)
    setLoading(false)
    onSelect(item)
    setOpen(false)
    setResults([])
  }

  const displayValue = strictSelect ? query : value

  return (
    <div className="typeahead-wrap" ref={wrapRef}>
      <input ref={inputRef} value={displayValue} onChange={handleChange} onBlur={handleBlur} placeholder={placeholder} disabled={disabled} autoComplete="off" />
      {open && (
        <div className="typeahead-dropdown" style={dropStyle}>
          {loading
            ? <div className="typeahead-empty">Searching...</div>
            : results.length === 0
              ? <div className="typeahead-empty">No results</div>
              : results.map((r, i) => {
                const brk = separator ? separator(results[i - 1], r) : null
                return (
                  <div key={i}>
                    {brk && <div className="typeahead-sep">{brk}</div>}
                    <div className="typeahead-item" onMouseDown={() => select(r)}>
                      {renderItem(r)}
                    </div>
                  </div>
                )
              })
          }
        </div>
      )}
    </div>
  )
}
