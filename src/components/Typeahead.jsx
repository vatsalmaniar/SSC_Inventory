import { useState, useEffect, useRef, useCallback } from 'react'

export default function Typeahead({ value, onChange, onSelect, placeholder, fetchFn, renderItem, disabled }) {
  const [open, setOpen]       = useState(false)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [dropStyle, setDropStyle] = useState({})
  const timerRef              = useRef(null)
  const wrapRef               = useRef(null)
  const inputRef              = useRef(null)

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
    onChange(v)
    if (!v.trim()) { setResults([]); setOpen(false); return }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      const data = await fetchFn(v)
      setResults(data)
      calcPosition()
      setOpen(true)
      setLoading(false)
    }, 250)
  }

  function select(item) {
    onSelect(item)
    setOpen(false)
    setResults([])
  }

  return (
    <div className="typeahead-wrap" ref={wrapRef}>
      <input ref={inputRef} value={value} onChange={handleChange} placeholder={placeholder} disabled={disabled} autoComplete="off" />
      {open && (
        <div className="typeahead-dropdown" style={dropStyle}>
          {loading
            ? <div className="typeahead-empty">Searching...</div>
            : results.length === 0
              ? <div className="typeahead-empty">No results</div>
              : results.map((r, i) => (
                <div key={i} className="typeahead-item" onMouseDown={() => select(r)}>
                  {renderItem(r)}
                </div>
              ))
          }
        </div>
      )}
    </div>
  )
}
