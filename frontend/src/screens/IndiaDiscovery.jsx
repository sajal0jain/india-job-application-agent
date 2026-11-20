import React, { useState } from 'react'
import api from '../api'
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
      <p>Preview Delhi NCR and Remote India roles on up to three employer boards that permit automated access. Use Greenhouse, Lever, or Ashby board homepages.</p>
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
