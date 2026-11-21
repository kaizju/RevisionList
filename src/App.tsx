/* eslint-disable */
// @ts-nocheck
import { useEffect, useState, useCallback } from 'react'
import { supabase, DOMAIN } from './supabase'

const ROLES = { pm: 'Project Manager', programmer: 'Programmer', documentarian: 'Documentarian', analyst: 'Data Analyst' }
const STATUS = { todo: 'To do', doing: 'In progress', done: 'Done' }
const FINAL = new Date('2026-12-01T23:59:59')
const today = () => new Date().toISOString().slice(0, 10)
const late = r => r.status !== 'done' && r.deadline < today()

export default function App() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return null
  if (!session) return (
    <div className="login">
      <h1>HopeLine Revision Tracker</h1>
      <p className="sub">Sign in with your @{DOMAIN} account.</p>
      <button className="pri" onClick={() => supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: location.origin, queryParams: { hd: DOMAIN }, scopes: 'https://www.googleapis.com/auth/documents' } })}>
        Sign in with Google</button>
    </div>)
  if (!session.user.email?.endsWith('@' + DOMAIN)) return (
    <div className="login"><h1>Institutional email required</h1>
      <p className="sub">{session.user.email} is not an @{DOMAIN} account.</p>
      <button onClick={() => supabase.auth.signOut()}>Sign out</button></div>)
  return <Tracker user={session.user} token={session.provider_token} />
}

function Tracker({ user, token }) {
  const [tab, setTab] = useState('dashboard')
  const [revs, setRevs] = useState([]); const [people, setPeople] = useState([]); const [docs, setDocs] = useState([])
  const [comments, setComments] = useState([]); const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const [r, p, d, c] = await Promise.all([
      supabase.from('revisions').select('*').order('deadline'),
      supabase.from('profiles').select('*'),
      supabase.from('chapter_docs').select('*').order('chapter'),
      supabase.from('revision_comments').select('*').order('created_at')])
    const e = r.error || p.error || d.error || c.error
    if (e) setErr(e.message)
    setRevs(r.data || []); setPeople(p.data || []); setDocs(d.data || []); setComments(c.data || [])
  }, [])
  useEffect(() => {
    supabase.from('profiles').upsert({ id: user.id, email: user.email,
      full_name: user.user_metadata?.full_name }, { onConflict: 'id', ignoreDuplicates: true }).then(load)
  }, [user, load])
  const me = people.find(p => p.id === user.id)
  const daysLeft = Math.max(0, Math.ceil((FINAL - new Date()) / 864e5))

  return (<>
    <header>
      <h1>HopeLine Revisions</h1>
      <nav>{[['dashboard', 'Dashboard'], ['list', 'Revision list'], ['chapters', 'Chapters']].map(([k, l]) =>
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <span className="sub">
        <select aria-label="My role" value={me?.role || 'documentarian'}
          onChange={async e => { await supabase.from('profiles').update({ role: e.target.value }).eq('id', user.id); load() }}>
          {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
        <button onClick={() => supabase.auth.signOut()}>Sign out</button></span>
    </header>
    <main>
      {err && <p className="late">Database error: {err}. Did you run supabase/schema.sql?</p>}
      {tab === 'dashboard' && <Dashboard {...{ revs, people, daysLeft }} />}
      {tab === 'list' && <List {...{ revs, people, load, comments, uid: user.id }} />}
      {tab === 'chapters' && <Chapters {...{ revs, docs, load, token }} />}
    </main></>)
}

function Dashboard({ revs, people, daysLeft }) {
  const done = revs.filter(r => r.status === 'done').length
  const pct = n => (revs.length ? Math.round((n / revs.length) * 100) : 0)
  return (<>
    <div className="box"><div className="days">{daysLeft} days</div>
      <div className="sub">until the December 1, 2026 submission</div>
      <div className="bar"><i style={{ width: pct(done) + '%' }} /></div>
      <div>{done} of {revs.length} revisions done ({pct(done)}%), {revs.filter(late).length} overdue</div></div>
    <div className="grid">{Object.entries(ROLES).map(([k, label]) => {
      const ids = people.filter(p => p.role === k).map(p => p.id)
      const mine = revs.filter(r => ids.includes(r.assignee))
      const d = mine.filter(r => r.status === 'done').length
      return (<div className="box" key={k}><strong>{label}</strong>
        <div className="sub">{people.filter(p => p.role === k).map(p => p.full_name || p.email).join(', ') || 'No one yet'}</div>
        <div className="bar"><i style={{ width: (mine.length ? d / mine.length * 100 : 0) + '%' }} /></div>
        <div>{d}/{mine.length} done{mine.filter(late).length > 0 && <span className="late"> · {mine.filter(late).length} overdue</span>}</div></div>)
    })}</div>
    <div className="grid">{['system', 'manuscript'].map(p => {
      const l = revs.filter(r => r.part === p), d = l.filter(r => r.status === 'done').length
      return (<div className="box" key={p}><strong>{p === 'system' ? 'HopeLine System' : 'Capstone Manuscript'}</strong>
        <div className="bar"><i style={{ width: (l.length ? d / l.length * 100 : 0) + '%' }} /></div><div>{d}/{l.length} done</div></div>)
    })}</div></>)
}

function List({ revs, people, load, comments, uid }) {
  const [f, setF] = useState({ part: '', status: '', mine: false })
  const [open, setOpen] = useState(false)
  const blank = { part: 'manuscript', panelist: '', title: '', chapters: [], section_note: '', assignee: '', start_date: today(), deadline: '2026-12-01' }
  const [n, setN] = useState(blank)
  const shown = revs.filter(r => (!f.part || r.part === f.part) && (!f.status || r.status === f.status) && (!f.mine || r.assignee === uid))
  const name = id => { const p = people.find(x => x.id === id); return p ? (p.full_name || p.email) : 'Unassigned' }
  const save = async () => {
    if (!n.panelist || !n.title) return alert('Enter the panelist and the revision.')
    await supabase.from('revisions').insert({ ...n, assignee: n.assignee || null }); setN(blank); setOpen(false); load()
  }
  const upd = async (id, patch) => { await supabase.from('revisions').update(patch).eq('id', id); load() }
  return (<>
    <div className="tools">
      <select value={f.part} onChange={e => setF({ ...f, part: e.target.value })} aria-label="Part">
        <option value="">System + Manuscript</option><option value="system">HopeLine System</option><option value="manuscript">Manuscript</option></select>
      <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} aria-label="Status">
        <option value="">Any status</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <label><input type="checkbox" checked={f.mine} onChange={e => setF({ ...f, mine: e.target.checked })} /> Mine only</label>
      <button className="pri" onClick={() => setOpen(!open)}>Add revision</button></div>
    {open && <div className="box form" style={{ marginBottom: 12 }}>
      <select value={n.part} onChange={e => setN({ ...n, part: e.target.value })}>
        <option value="manuscript">Manuscript</option><option value="system">HopeLine System</option></select>
      <input placeholder="Panelist name" value={n.panelist} onChange={e => setN({ ...n, panelist: e.target.value })} />
      <textarea className="full" placeholder="What the panelist suggested" value={n.title} onChange={e => setN({ ...n, title: e.target.value })} />
      <div className="full">Chapters to change:{' '}{[1, 2, 3, 4, 5].map(c => <label key={c} style={{ marginRight: 10 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={n.chapters.includes(c)}
          onChange={() => setN({ ...n, chapters: n.chapters.includes(c) ? n.chapters.filter(x => x !== c) : [...n.chapters, c].sort() })} /> {c}</label>)}</div>
      <input className="full" placeholder="Which section (e.g. 3.2 Research Design)" value={n.section_note} onChange={e => setN({ ...n, section_note: e.target.value })} />
      <select value={n.assignee} onChange={e => setN({ ...n, assignee: e.target.value })}>
        <option value="">Unassigned</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>
      <label>Started <input type="date" value={n.start_date} onChange={e => setN({ ...n, start_date: e.target.value })} /></label>
      <label>Deadline <input type="date" value={n.deadline} onChange={e => setN({ ...n, deadline: e.target.value })} /></label>
      <button className="pri" onClick={save}>Save revision</button></div>}
    <div className="box">{shown.length === 0 && <p className="sub">No revisions yet. Add the first one from the panel's comments.</p>}
      {shown.map(r => <div className="row" key={r.id}>
        <div><strong>{r.title}</strong><div className="sub">Suggested by {r.panelist} · {r.part === 'system' ? 'System' : 'Manuscript'} · {name(r.assignee)}</div>
          <div>{r.chapters.map(c => <span className="tag" key={c}>Chapter {c}</span>)}{r.section_note}</div>
          <div className={late(r) ? 'late' : 'sub'}>Started {r.start_date} · Due {r.deadline}{late(r) && ' (overdue)'}</div>
          <Notes rev={r} comments={comments.filter(c => c.revision_id === r.id)} people={people} uid={uid} load={load} /></div>
        <div><select value={r.status} aria-label="Status" onChange={e => upd(r.id, { status: e.target.value })}>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{' '}
          <select value={r.assignee || ''} aria-label="Assignee" onChange={e => upd(r.id, { assignee: e.target.value || null })}>
            <option value="">Unassigned</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}</select>{' '}
          <button onClick={async () => { if (confirm('Delete this revision?')) { await supabase.from('revisions').delete().eq('id', r.id); load() } }}>Delete</button></div></div>)}</div></>)
}

function Chapters({ revs, docs, load, token }) {
  const push = async (c, list, url) => {
    const id = url?.match(/\/d\/([\w-]+)/)?.[1]
    if (!id) return alert('Paste the full Google Doc link first.')
    if (!token) return alert('Sign out and sign in again to give Google Docs access.')
    const text = `\nRevision checklist, Chapter ${c} (${today()})\n` + list.map(r =>
      `${r.status === 'done' ? '[x]' : '[ ]'} ${r.title} (${r.panelist}, due ${r.deadline})`).join('\n') + '\n'
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${id}:batchUpdate`, { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: {}, text } }] }) })
    alert(res.ok ? 'Checklist added to the end of the doc.' : `Google refused (${res.status}). Sign in again, or ask your school admin to allow the Docs API.`)
  }
  const titles = ['Introduction', 'Review of Related Literature', 'Methodology', 'Results and Discussion', 'Summary, Conclusion, Recommendations']
  return (<>{[1, 2, 3, 4, 5].map(c => {
    const l = revs.filter(r => r.chapters.includes(c)), d = l.filter(r => r.status === 'done').length
    const doc = docs.find(x => x.chapter === c)
    return (<div className="box" key={c} style={{ marginBottom: 12 }}>
      <strong>Chapter {c}: {titles[c - 1]}</strong>
      <div className="bar"><i style={{ width: (l.length ? d / l.length * 100 : 0) + '%' }} /></div>
      <div className="sub">{d}/{l.length} revisions done</div>
      <div className="tools"><input style={{ flex: 1, minWidth: 220, padding: 6 }} placeholder="Paste Google Doc link" defaultValue={doc?.doc_url || ''}
        onBlur={async e => { await supabase.from('chapter_docs').update({ doc_url: e.target.value }).eq('chapter', c); load() }} />
        {doc?.doc_url && l.length > 0 && <button onClick={() => push(c, l, doc.doc_url)}>Add checklist to Doc</button>}
        {doc?.doc_url && <a href={doc.doc_url} target="_blank" rel="noreferrer"><button>Open in Google Docs</button></a>}</div>
      {l.map(r => <div className="row" key={r.id}><span>{r.title}{r.section_note && <span className="sub"> · {r.section_note}</span>}</span>
        <span className={late(r) ? 'late' : 'sub'}>{STATUS[r.status]} · due {r.deadline}</span></div>)}</div>)
  })}</>)
}

function Notes({ rev, comments, people, uid, load }) {
  const [t, setT] = useState(''); const [o, setO] = useState(false)
  const who = id => { const p = people.find(x => x.id === id); return p ? (p.full_name || p.email) : 'Someone' }
  const add = async () => {
    if (!t.trim()) return
    await supabase.from('revision_comments').insert({ revision_id: rev.id, author: uid, body: t.trim() }); setT(''); load()
  }
  return (<div><button onClick={() => setO(!o)}>Notes ({comments.length})</button>
    {o && <div style={{ marginTop: 6 }}>{comments.map(c => <div key={c.id} className="sub"><strong>{who(c.author)}:</strong> {c.body}</div>)}
      <div className="tools"><input style={{ flex: 1, padding: 6 }} placeholder="Add a note" value={t} onChange={e => setT(e.target.value)} />
        <button className="pri" onClick={add}>Save note</button></div></div>}</div>)
}