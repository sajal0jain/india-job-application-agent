import React, { useEffect, useState } from 'react'
import api from '../api'
import EmployerWatchlist from './EmployerWatchlist'
import { Button, Card, Heading, Input, Link, Select } from '../ui'

export default function IndiaDiscovery() {
  const [boards, setBoards] = useState(['', '', ''])
  const [level, setLevel] = useState('All')
  const [preview, setPreview] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState({})
  const [saving, setSaving] = useState('')

  async function search(event) {
    event.preventDefault()
    setRunning(true)
    setError('')
    setPreview(null)
    setSaved({})
    try {
      const { data } = await api.post('/india-discovery/preview', {
        boards: boards.map((url) => url.trim()).filter(Boolean), level,
      })
      setPreview(data)
    } catch (e) {
      const detail = e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Could not preview employer boards.')
    } finally {
      setRunning(false)
    }
  }

  async function save(job) {
    setSaving(job.url)
    try {
      const { data } = await api.post('/jobs/manual', {
        title: job.title, company: job.company, url: job.url,
        location: job.location, status: 'saved', dedup_by_posting: true,
      })
      setSaved((previous) => ({ ...previous, [job.url]: data.created ? 'Saved to Jobs' : 'Already in Jobs' }))
    } catch {
      setSaved((previous) => ({ ...previous, [job.url]: 'Save failed. Try again.' }))
    } finally {
      setSaving('')
    }
  }

  return (
    <Card>
      <Heading strong>India leadership discovery</Heading>
      <ScheduledDiscovery />
      <p>Preview Gurugram, Delhi NCR, Remote India, and worldwide remote roles on up to three employer boards that permit automated access. Use Greenhouse, Lever, or Ashby board homepages.</p>
      <form onSubmit={search} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {boards.map((url, index) => (
          <Input key={index} type="url" ariaLabel={`Employer board ${index + 1}`}
            placeholder={`Employer board ${index + 1}`} value={url} disabled={running}
            onChange={(value) => setBoards((previous) => previous.map((board, i) => i === index ? value : board))} />
        ))}
        <Select ariaLabel="Seniority" value={level} onPick={setLevel} disabled={running} options={[
          ['All', 'All levels'],
          ['Director', 'Director and Head'],
          ['Manager', 'Manager and Senior Manager'],
        ]} />
        <Button as="button" type="submit" disabled={running || !!saving || !boards.some((url) => url.trim())}>
          {running ? 'Checking boards…' : 'Preview jobs'}
        </Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div aria-live="polite">
          <p>{preview.total > preview.jobs.length ? `Showing ${preview.jobs.length} of ` : ''}{preview.total} candidates</p>
          {preview.errors.map(({ board, reason }) => <p key={board}>{board} · {reason}</p>)}
          {preview.jobs.map((job) => (
            <div key={job.url} style={{ paddingBlock: 8 }}>
              <Link href={job.url} target="_blank" rel="noopener noreferrer">{job.title}</Link>
              <div>{job.company} · {job.level}{job.location && ` · ${job.location}`}</div>
              <div>{job.decision === 'review' && 'Review needed · '}{job.reason}</div>
              <Button disabled={!!saving || ['Saved to Jobs', 'Already in Jobs'].includes(saved[job.url])}
                onClick={() => save(job)}>
                {saving === job.url ? 'Saving…' : saved[job.url] || 'Save to Jobs'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function ScheduledDiscovery() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let active = true
    let timer
    async function poll() {
      let delay = 30000
      try {
        const response = await api.get('/india-discovery/sweep')
        if (active) setStatus(response.data)
        if (response.data.running) delay = 5000
      } catch (error) {
        if (error.response?.status === 403) return
      }
      if (active) timer = setTimeout(poll, delay)
    }
    poll()
    return () => { active = false; clearTimeout(timer) }
  }, [])

  async function start() {
    setStarting(true)
    setError('')
    try {
      const { data } = await api.post('/india-discovery/sweep')
      setStatus(data)
    } catch (error) {
      setError(error.response?.data?.detail || 'Could not start discovery.')
    } finally {
      setStarting(false)
    }
  }

  if (!status) return null
  return (
    <details open={status.running || undefined}>
      <summary>Automatic search</summary>
      <p>{status.enabled_hours ? `Runs every ${status.enabled_hours} hours while Docker is running.` : 'Scheduled runs are off.'}
        {' '}Configured sources: {status.boards} employer boards{status.portals.map((name) => ` · ${name}`).join('')}.</p>
      <Button disabled={starting || status.running || (!status.boards && !status.portals.length)} onClick={start}>
        {starting || status.running ? 'Searching…' : 'Run configured sources'}
      </Button>
      <EmployerWatchlist onSave={(boards) => setStatus((previous) => ({ ...previous, boards }))} />
      {error && <p role="alert">{error}</p>}
      {status.last && (
        <>
          <p>Last run {new Date(status.last.finished_at).toLocaleString()}</p>
          {status.last.error && <p>{status.last.error}</p>}
          <ul>{status.last.sources.map((source, index) => <li key={index}>
            {source.source} · {source.added || 0} added · {source.review || 0} need location review
            {!!source.capped_queries && ` · ${source.capped_queries} queries reached the page limit`}
            {source.error && ` · ${source.error}`}
            {source.note && ` · ${source.note}`}
          </li>)}</ul>
        </>
      )}
    </details>
  )
}
