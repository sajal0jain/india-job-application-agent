import React, { useState } from 'react'
import api from '../api'
import { Button, Textarea } from '../ui'

export default function EmployerWatchlist({ onSave }) {
  const [value, setValue] = useState('')
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function update(save) {
    setBusy(true)
    setMessage('')
    try {
      const path = '/india-discovery/watchlist'
      const { data } = save ? await api.put(path, { boards: value.split('\n') }) : await api.get(path)
      setValue(data.boards.join('\n'))
      setOpened(true)
      if (save) {
        setMessage('Watchlist saved.')
        onSave(data.boards.length)
      }
    } catch (error) {
      const detail = error.response?.data?.detail
      setMessage(typeof detail === 'string' ? detail : 'Could not update the watchlist.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {!opened && <Button disabled={busy} onClick={() => update(false)}>Edit employer watchlist</Button>}
      {opened && (
        <>
          <p>Enter one supported board homepage per line for employers that permit automated access. The saved list becomes the source for future sweeps.</p>
          <Textarea ariaLabel="Employer board homepages" value={value} onChange={setValue} disabled={busy} rows={5} />
          <p><Button disabled={busy} onClick={() => update(true)}>Save employer watchlist</Button></p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  )
}
