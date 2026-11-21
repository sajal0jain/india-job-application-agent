import React, { useState } from 'react'
import api from '../api'
import { Button, Card, Heading, Input, Textarea } from '../ui'

export default function AlertIntake() {
  const [text, setText] = useState('')
  const [jobs, setJobs] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const update = (url, changes) => setJobs((previous) => previous.map((item) =>
    item.url === url ? { ...item, ...changes } : item))

  async function request(operation) {
    setBusy(true)
    setMessage('')
    try {
      await operation()
    } catch (error) {
      const detail = error.response?.data?.detail
      setMessage(typeof detail === 'string' ? detail : 'Could not process the alert.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <Heading strong>Import a job link or alert</Heading>
      <p>Paste one employer job link, or load a job alert from LinkedIn, Naukri, Foundit, or Instahyre.</p>
      <input type="file" accept=".eml,.txt,.html" aria-label="Load job alert email" disabled={busy}
        onChange={(event) => {
          const file = event.target.files[0]
          if (file) request(async () => {
            if (file.size > 500000) throw new Error('File too large')
            setText(await file.text())
          })
        }} />
      <p><Textarea ariaLabel="Job alert text" value={text} onChange={setText} rows={4} maxLength={500000} disabled={busy} /></p>
      <Button disabled={busy || !text.trim()} onClick={() => request(async () => {
        const { data } = await api.post('/india-workflow/alerts/preview', { text })
        setJobs(data.jobs)
        if (!data.jobs.length) setMessage('No posting links found. Paste a single HTTPS job URL, or upload a supported alert.')
      })}>Preview alert</Button>
      {message && <p role="status">{message}</p>}
      {jobs.map((job) => (
        <div key={job.url} style={{ marginBlock: 12 }}>
          <p>{job.portal} · <a href={job.url} target="_blank" rel="noopener noreferrer">Open posting</a></p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['title', 'company', 'location'].map((field) => <Input key={field} ariaLabel={field} placeholder={field}
              value={job[field] || ''} onChange={(value) => update(job.url, { [field]: value })} disabled={busy || job.done} />)}
          </div>
          <Textarea ariaLabel="Posting description" placeholder="Paste the posting description for CV ranking"
            value={job.description || ''} onChange={(description) => update(job.url, { description })} rows={2} maxLength={16000} disabled={busy || job.done} />
          <p><Button disabled={busy || job.done || !job.title.trim()} onClick={() => request(async () => {
            const { data } = await api.post('/india-workflow/alerts/import', {
              url: job.url, title: job.title, company: job.company || '', location: job.location || '', description: job.description || '',
              ...(job.direct_employer ? { direct_employer: true } : {}),
            })
            update(job.url, { done: true, result: data.added ? 'Added to Jobs' : 'Already in Jobs' })
          })}>{job.result || 'Import job for review'}</Button></p>
        </div>
      ))}
    </Card>
  )
}
