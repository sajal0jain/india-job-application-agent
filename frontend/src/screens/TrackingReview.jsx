import React, { useState } from 'react'
import api from '../api'
import { Button, Textarea } from '../ui'

const PATH = '/india-workflow/tracking'
const STAGES = { applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected' }

export default function TrackingReview({ onConfirmed }) {
  const [outcomes, setOutcomes] = useState(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [applicationId, setApplicationId] = useState('')
  const [stage, setStage] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const application = preview?.applications.find(({ id }) => id === applicationId)

  async function run(operation) {
    setBusy(true)
    setMessage('')
    try {
      await operation()
    } catch (error) {
      const detail = error.response?.data?.detail
      setMessage(typeof detail === 'string' ? detail : 'Could not update application tracking.')
    } finally {
      setBusy(false)
    }
  }

  async function loadOutcomes() {
    const { data } = await api.get(`${PATH}/outcomes`)
    setOutcomes(data)
  }

  return (
    <details style={{ margin: '0 24px 12px' }}>
      <summary>Email review and hiring outcomes</summary>
      <div className="v2-scroll" style={{ maxHeight: '50vh', overflow: 'auto', paddingBlock: 8 }}>
        <Button disabled={busy} onClick={() => run(loadOutcomes)}>Load outcome counts</Button>
        {outcomes && (
          <section>
            <p>Current stages · {Object.entries(outcomes.stages).map(([key, count]) => `${STAGES[key]}: ${count}`).join(' · ')}</p>
            <p>Stage before rejection · {Object.entries(outcomes.before_rejection).map(([key, count]) => `${key}: ${count}`).join(' · ')}</p>
          </section>
        )}
        <p>Paste a recruiter email containing a job or requisition ID to find a tracked application.</p>
        <Textarea ariaLabel="Recruiter email" value={text} disabled={busy} rows={3} maxLength={50000}
          onChange={(value) => { setText(value); setPreview(null); setApplicationId(''); setStage('') }} />
        <p><Button disabled={busy || !text.trim()} onClick={() => run(async () => {
          const { data } = await api.post(`${PATH}/email-preview`, { text })
          setPreview(data)
          setApplicationId('')
          setStage('')
        })}>Preview email match</Button></p>
        {preview && (
          preview.applications.length ? (
            <div>
              <p>Suggested email classification: {preview.classification.replace('_', ' ')}</p>
              <select aria-label="Application to update" value={applicationId}
                disabled={busy} onChange={(event) => setApplicationId(event.target.value)}>
                <option value="">Choose application</option>
                {preview.applications.map((item) => (
                  <option key={item.id} value={item.id}>{item.company} · {item.title} · {STAGES[item.status]}</option>
                ))}
              </select>{' '}
              <select aria-label="Confirmed status" value={stage} disabled={busy}
                onChange={(event) => setStage(event.target.value)}>
                <option value="">Choose status</option>
                {Object.entries(STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>{' '}
              <Button disabled={busy || !application || !stage || stage === application.status}
                onClick={() => run(async () => {
                  await api.post(`${PATH}/email-confirm`, {
                    application_id: application.id, expected_status: application.status, status: stage, confirmed: true,
                  })
                  setText('')
                  setPreview(null)
                  setApplicationId('')
                  setStage('')
                  setMessage('Application status updated.')
                  await onConfirmed()
                  if (outcomes) await loadOutcomes()
                })}>Confirm status update</Button>
            </div>
          ) : <p>No matching tracked requisition. Review the email and update the application directly if needed.</p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </details>
  )
}
