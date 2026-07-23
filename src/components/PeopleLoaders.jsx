// Polished loading states for the People pages.
// NOTE: Spinner now delegates to the shared <Loading/> so every page uses one
// loading visual. Skeletons below stay as the People-specific skeleton pattern.
import Loading from './Loading'

export function Spinner({ label = 'Loading…' }) {
  return <Loading label={label} />
}

export function TeamSkeleton() {
  return (
    <>
      <div className="ph"><div><div className="skel skel-line" style={{ width: 120, height: 26 }} /><div className="skel skel-line" style={{ width: 240, marginTop: 10 }} /></div></div>
      <div className="skel" style={{ height: 60, marginBottom: 16 }} />
      <div className="card">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skel-row">
            <div className="skel skel-line" style={{ width: 40 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div className="skel skel-av" /><div style={{ flex: 1 }}><div className="skel skel-line" style={{ width: '60%' }} /><div className="skel skel-line" style={{ width: '40%', marginTop: 6, height: 9 }} /></div></div>
            <div className="skel skel-line" style={{ width: 90 }} />
            <div className="skel skel-line" style={{ width: '70%' }} />
            <div className="skel skel-line" style={{ width: 70 }} />
            <div className="skel skel-line" style={{ width: 50 }} />
            <div className="skel skel-line" style={{ width: 70 }} />
            <div className="skel skel-line" style={{ width: 28, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </>
  )
}

export function AssetsSkeleton() {
  return (
    <>
      <div className="ph"><div><div className="skel skel-line" style={{ width: 180, height: 26 }} /><div className="skel skel-line" style={{ width: 260, marginTop: 10 }} /></div></div>
      <div className="astats">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skel" style={{ height: 72 }} />)}</div>
      <div className="skel" style={{ height: 60, marginBottom: 16 }} />
      <div className="card">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skel-arow">
            <div className="skel skel-line" style={{ width: 100 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}><div className="skel" style={{ width: 34, height: 34, borderRadius: 9 }} /><div className="skel skel-line" style={{ width: '55%' }} /></div>
            <div className="skel skel-line" style={{ width: 70 }} />
            <div className="skel skel-line" style={{ width: 90 }} />
            <div className="skel skel-line" style={{ width: 80 }} />
            <div className="skel skel-line" style={{ width: 110 }} />
            <div className="skel skel-line" style={{ width: 60, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </>
  )
}

export function ProfileSkeleton() {
  return (
    <div className="pv">
      <div className="skel skel-cover" style={{ gridColumn: '1/-1' }} />
      <aside className="pside"><div className="skel skel-card" /><div className="skel skel-card" style={{ height: 220 }} /></aside>
      <div className="pmain"><div className="skel" style={{ height: 42, borderRadius: 10 }} /><div className="pmain-grid"><div className="skel skel-card" /><div className="skel skel-card" /><div className="skel skel-card" /><div className="skel skel-card" /></div></div>
    </div>
  )
}
