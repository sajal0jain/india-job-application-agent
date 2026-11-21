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
      <Heading strong>Preview employer boards</Heading>
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

const DISCOVERY_SOURCES = ['employer', 'adzuna', 'jooble', 'remotive', 'alert']
  .flatMap((source) => [`india_${source}`, `india_${source}_review`]).join(',')

export function JobSearch() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [starting, setStarting] = useState(false)
  const [jobs, setJobs] = useState(null)
  const [jobsError, setJobsError] = useState(false)
  const [filter, setFilter] = useState('')
  const running = Boolean(status?.running || starting)
  const finishedAt = status?.last?.finished_at

  useEffect(() => {
    let active = true
    let timer
    async function poll() {
      try {
        const { data } = await api.get('/india-discovery/sweep')
        if (active) { setStatus(data); setStatusError('') }
      } catch (error) {
        if (active) setStatusError(error.response?.status === 403
          ? 'Automatic search is available to the dashboard owner.'
          : 'Could not load search status.')
        if (error.response?.status === 403) return
      }
      if (active) timer = setTimeout(poll, running ? 2000 : 10000)
    }
    poll()
    return () => { active = false; clearTimeout(timer) }
  }, [running])

  useEffect(() => {
    let active = true
    api.get('/jobs', { params: { source: DISCOVERY_SOURCES, status: 'new,saved', limit: 30, brief: true,
      fields: 'id,title,company,location,source' } })
      .then(({ data }) => { if (active) { setJobs(data.jobs); setJobsError(false) } })
      .catch(() => { if (active) setJobsError(true) })
    return () => { active = false }
  }, [finishedAt])

  async function start() {
    setStarting(true)
    setError('')
    try {
      const { data } = await api.post('/india-discovery/sweep?include_remote=true')
      setStatus(data)
    } catch (error) {
      setError(error.response?.data?.detail || 'Could not start search.')
    } finally {
      setStarting(false)
    }
  }

  const terms = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const visible = (jobs || []).filter((job) => {
    const text = `${job.title || ''} ${job.company || ''} ${job.location || ''}`.toLowerCase()
    return terms.every((term) => text.includes(term))
  })
  const imported = status?.last?.sources.reduce((count, source) => count + (source.added || 0), 0) || 0
  const failures = status?.last?.sources.filter((source) => source.error).length || 0
  const remoteOnly = status && !status.boards && !status.portals.some((name) => name !== 'Remotive')

  return (
    <Card>
      <Heading strong>Find leadership jobs</Heading>
      <p>Manager, Director and Head roles in AI, analytics and data science across Gurugram, Delhi NCR and remote locations open to India.</p>
      <Button disabled={!status || running} onClick={start}>{running ? 'Searching…' : 'Find jobs'}</Button>
      {remoteOnly && <p>Remotive is ready to search. Add employer boards under Search sources to cover more local roles.</p>}
      {(error || statusError) && <p role="alert">{error || statusError}</p>}
      {status && <details>
        <summary>Search sources</summary>
        <p>Remotive runs on demand. {status.boards} employer boards configured
          {status.portals.length ? ` · ${status.portals.join(', ')}` : ''}.
          {' '}{status.enabled_hours ? `Automatic sweeps run every ${status.enabled_hours} hours while Docker is running.` : 'Scheduled sweeps are off.'}</p>
        <EmployerWatchlist onSave={(boards) => setStatus((previous) => ({ ...previous, boards }))} />
      </details>}
      <div aria-live="polite">
        {running && <p>Checking available sources. Results will appear here when the search finishes.</p>}
        {!running && status?.last && (
          <>
            <p>{status.last.error || `${imported} new job${imported === 1 ? '' : 's'} added${failures ? ` · ${failures} sources returned errors` : ''}.`}</p>
            <details>
              <summary>Last search details</summary>
              <p>{new Date(finishedAt).toLocaleString()}</p>
              <ul>{status.last.sources.map((source, index) => <li key={index}>
                {source.source} · {source.added || 0} added · {source.duplicate || 0} already seen
                {!!source.capped_queries && ` · ${source.capped_queries} queries reached the page limit`}
                {source.error && ` · ${source.error}`}{source.note && ` · ${source.note}`}
              </li>)}</ul>
            </details>
          </>
        )}
      </div>
      {jobsError && <p>Could not load recent discoveries. <Link href="/feed">Open Jobs feed</Link></p>}
      {!running && status?.last && jobs?.length === 0 && <p>No open jobs from the discovery sources yet.</p>}
      {!!jobs?.length && (
        <div style={{ marginTop: 14 }}>
          <Heading strong>Recent discoveries</Heading>
          <p><Link href="/feed">Open Jobs feed</Link></p>
          <Input ariaLabel="Filter recent discoveries" value={filter} onChange={setFilter} placeholder="Filter by role, company or location" />
          {visible.length === 0 && <p>No recent jobs match this filter.</p>}
          <ul>{visible.map((job) => (
            <li key={job.id} style={{ marginBlock: 8 }}>
              <Link href={`/application-queue/${job.id}`}>{job.title}</Link>
              {' · '}{job.company || 'Employer unspecified'}{job.location && ` · ${job.location}`}
              {job.source?.endsWith('_review') && ' · Confirm location eligibility'}
            </li>
          ))}</ul>
        </div>
      )}
    </Card>
  )
}
