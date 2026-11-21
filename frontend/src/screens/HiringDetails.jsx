import React, { useState } from 'react'
import api from '../api'
import { Button, Input } from '../ui'

const FIELDS = {
  fixed_ctc: 'Fixed CTC', variable_ctc: 'Variable CTC', notice_period: 'Accepted notice period',
  buyout: 'Notice period buyout', work_location: 'Work location or hybrid policy',
  team_scope: 'Team size and remit', source: 'Posting or recruiter source',
}

export default function HiringDetails({ route }) {
  const [details, setDetails] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function update(save) {
    setBusy(true)
    setMessage('')
    try {
      const { data } = save ? await api.put(`${route}/hiring`, details) : await api.get(`${route}/hiring`)
      setDetails(data)
      if (save) setMessage('Hiring details saved.')
    } catch {
      setMessage('Could not load or save hiring details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginBlock: 12 }}>
      {!details && <Button disabled={busy} onClick={() => update(false)}>Review India hiring details</Button>}
      {details && (
        <>
          <p>Record employer-stated terms and their source. Leave unknown terms blank.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(FIELDS).map(([key, label]) => (
              <Input key={key} ariaLabel={label} placeholder={label} disabled={busy} value={details[key]}
                maxLength={key === 'source' ? 360 : key === 'team_scope' ? 350 : 180}
                onChange={(value) => setDetails({ ...details, [key]: value })} />
            ))}
          </div>
          <p><Button disabled={busy} onClick={() => update(true)}>Save hiring details</Button></p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  )
}
