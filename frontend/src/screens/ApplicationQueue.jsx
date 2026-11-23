import React, { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import api from '../api'
import HiringDetails from './HiringDetails'
import { Button, Card, Heading, Input, Link, PageTitle, Textarea } from '../ui'

const PATH = '/india-workflow'
const CONTACT = ['Name', 'Email', 'Phone', 'Location']
const SECTIONS = [...CONTACT, 'Summary', 'Experience', 'Skills', 'Education', 'Certifications', 'Screening']
const EMPTY = { section: 'Experience', text: '', source: '' }
const errorText = (error) => typeof error.response?.data?.detail === 'string'
  ? error.response.data.detail : 'The request failed. Check the fields and try again.'

export default function ApplicationQueue() {
  const { jobId } = useParams()
  const [facts, setFacts] = useState([])
  const [queue, setQueue] = useState([])
  const [jobs, setJobs] = useState([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [confirmFacts, setConfirmFacts] = useState(false)
  const [profileDirty, setProfileDirty] = useState(false)
  const [ready, setReady] = useState(false)

  async function run(label, operation) {
    setMessage('')
    setBusy(label)
    try {
      await operation()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setBusy('')
    }
  }

  async function refreshQueue() {
    const { data } = await api.get(`${PATH}/queue`)
    setQueue(data)
  }

  useEffect(() => {
    let active = true
    Promise.all([
      api.get(`${PATH}/profile`),
      api.get(`${PATH}/queue`),
      api.get('/jobs', { params: { saved: true, brief: true, fields: 'id,title,company', limit: 200 } }),
    ]).then(([profile, drafts, saved]) => {
      if (!active) return
      setFacts(profile.data.facts)
      setQueue(drafts.data)
      setJobs(saved.data.jobs)
      setReady(true)
    }).catch((error) => { if (active) setMessage(errorText(error)) })
    return () => { active = false }
  }, [])

  function updateFacts(next) {
    setFacts(next)
    setProfileDirty(true)
    setConfirmFacts(false)
  }

  async function importCv(file) {
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    const { data } = await api.post(`${PATH}/profile/import-preview`, body)
    const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ')
    const key = ({ section, text }) => CONTACT.includes(section) ? section : `${section}:${normalize(text)}`
    const seen = new Set(facts.filter(({ text }) => text.trim()).map(key))
    const next = [...facts]
    let skipped = data.omitted || 0
    for (const fact of data.facts) {
      if (seen.has(key(fact)) || next.length >= 80) {
        skipped += 1
        continue
      }
      seen.add(key(fact))
      next.push(fact)
    }
    const added = next.length - facts.length
    if (added) updateFacts(next)
    setMessage(`${added} CV facts added for review. ${skipped ? `${skipped} rows skipped (duplicates, existing contact fields, or limits). ` : ''}Review the rows before saving.`)
  }

  return (
    <main className="v2-scroll" style={{ overflow: 'auto', padding: 24, flex: 1, display: 'grid', gap: 12, alignContent: 'start' }}>
      <PageTitle>Application queue</PageTitle>
      {message && <p role="status">{message}</p>}
      <PreparePosting disabled={!ready || !!busy || profileDirty} hasFacts={!!facts.length}
        run={run} refreshQueue={refreshQueue} />
      <Card>
        <Heading strong>Verified master CV facts</Heading>
        <details>
          <summary>{facts.length} facts</summary>
          <p><label>Import facts from a Word CV (.docx){' '}
            <input type="file" accept=".docx" disabled={!ready || !!busy} onChange={(event) => {
              const file = event.currentTarget.files[0]
              event.currentTarget.value = ''
              if (file) run('import-cv', () => importCv(file))
            }} />
          </label></p>
          <p>The import runs locally. Review the extracted wording, section, and source before saving.</p>
          <p>Add each claim as it should appear on your resume. For experience, include the employer, role and dates where relevant. Record a source excerpt or reference for every fact. Add contact details separately and use Screening for confirmed answers such as notice period or work authorization.</p>
          {facts.map((fact, index) => (
            <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBlock: 4 }}>
              <select aria-label={`Section for fact ${index + 1}`} value={fact.section} disabled={!!busy}
                onChange={(event) => updateFacts(facts.map((item, i) => i === index ? { ...item, section: event.target.value } : item))}>
                {SECTIONS.map((section) => <option key={section}>{section}</option>)}
              </select>
              <Input ariaLabel={`Claim ${index + 1}`} value={fact.text} maxLength={360} disabled={!!busy}
                onChange={(text) => updateFacts(facts.map((item, i) => i === index ? { ...item, text } : item))} />
              <Input ariaLabel={`Source ${index + 1}`} value={fact.source} maxLength={360} disabled={!!busy}
                onChange={(source) => updateFacts(facts.map((item, i) => i === index ? { ...item, source } : item))} />
              <Button disabled={!!busy} onClick={() => updateFacts(facts.filter((_, i) => i !== index))}>Remove fact</Button>
            </div>
          ))}
          <Button disabled={!ready || !!busy || facts.length >= 80} onClick={() => updateFacts([...facts, EMPTY])}>Add fact</Button>
          <p><label><input type="checkbox" checked={confirmFacts} disabled={!profileDirty || !!busy}
            onChange={(event) => setConfirmFacts(event.target.checked)} /> I checked every fact against its source.</label></p>
          <Button disabled={!confirmFacts || !!busy || facts.some(({ text, source }) => !text.trim() || !source.trim())}
            onClick={() => run('profile', async () => {
              const { data } = await api.put(`${PATH}/profile`, {
                verified: true, facts: facts.map(({ section, text, source }) => ({ section, text, source })),
              })
              setFacts(data.facts)
              setConfirmFacts(false)
              setProfileDirty(false)
              await refreshQueue()
              setMessage('Verified facts saved. Review any outdated drafts.')
            })}>Save verified facts</Button>
        </details>
      </Card>
      {jobId && ready && <JobReview key={jobId} jobId={jobId} facts={facts} busy={busy || (profileDirty ? 'profile edits' : '')}
        run={run} refreshQueue={refreshQueue} />}
      <RankedJobs facts={facts} />
      <Card>
        <Heading strong>Drafts</Heading>
        {queue.length === 0 && <p>Generate a draft from a saved job.</p>}
        <ul>
          {queue.map((row) => <li key={row.job_id}><RouterLink to={`/application-queue/${row.job_id}`}>{row.title}</RouterLink> · {row.company} · {row.stale ? 'Update needed' : row.approved ? 'Approved' : 'Needs review'}</li>)}
        </ul>
      </Card>
      <Card>
        <Heading strong>Saved jobs</Heading>
        {jobs.length === 0 && <p>Save a posting in Jobs or in India leadership discovery.</p>}
        <ul>
          {jobs.map((job) => <li key={job.id}><RouterLink to={`/application-queue/${job.id}`}>{job.title}</RouterLink> · {job.company}</li>)}
        </ul>
      </Card>
    </main>
  )
}

function PreparePosting({ disabled, hasFacts, run, refreshQueue }) {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [posting, setPosting] = useState(null)
  const update = (field, value) => setPosting((previous) => ({ ...previous, [field]: value }))

  return (
    <Card>
      <Heading strong>Prepare an application from a link</Heading>
      <p>Load the posting, confirm its details, and prepare a draft using your verified CV facts.</p>
      <Input ariaLabel="Job posting URL" placeholder="https://…" value={url} disabled={disabled}
        onChange={(value) => { setUrl(value); setPosting(null) }} />
      <p><Button disabled={disabled || !url.trim()} onClick={() => run('preview', async () => {
        setPosting(null)
        const { data } = await api.post(`${PATH}/posting/preview`, { url: url.trim() })
        setPosting(data)
      })}>Load posting</Button></p>
      {posting && <>
        <Link href={posting.url} target="_blank" rel="noopener noreferrer">Open original posting</Link>
        {posting.note && <p role="status">{posting.note}</p>}
        {posting.job_id && <p>This posting is already in Jobs. An existing application draft will be kept.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[['title', 'Job title', 360], ['company', 'Employer', 240], ['location', 'Job location', 500]].map(([field, label, limit]) =>
            <Input key={field} ariaLabel={label} placeholder={label} maxLength={limit}
              value={posting[field] || ''} onChange={(value) => update(field, value)} disabled={disabled} />)}
        </div>
        <Textarea ariaLabel="Job description from posting" placeholder="Paste the description if it could not be loaded."
          value={posting.description || ''} onChange={(value) => update('description', value)}
          maxLength={16000} rows={6} disabled={disabled} />
        {!hasFacts && <p>Save your verified CV facts to generate a tailored draft.</p>}
        <p><Button disabled={disabled || !posting.title?.trim()} onClick={() => run('prepare', async () => {
          const { data } = await api.post(`${PATH}/posting/prepare`, {
            url: posting.url, title: posting.title, company: posting.company || '',
            location: posting.location || '', description: posting.description || '',
          })
          await refreshQueue()
          navigate(`/application-queue/${data.job_id}`)
          setPosting(null)
          setUrl('')
        })}>{hasFacts && posting.description?.trim() ? 'Prepare tailored draft' : 'Open for review'}</Button></p>
      </>}
    </Card>
  )
}

function JobReview({ jobId, facts, busy, run, refreshQueue }) {
  const route = `${PATH}/jobs/${jobId}`
  const [job, setJob] = useState(null)
  const [draft, setDraft] = useState(null)
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState('local')
  const [model, setModel] = useState('')
  const hosted = provider === 'openrouter' || provider === 'gemini'
  const [consent, setConsent] = useState(false)
  const [selection, setSelection] = useState([])
  const [answers, setAnswers] = useState([])
  const [dirty, setDirty] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const factById = new Map(facts.map((fact) => [fact.id, fact]))
  const cvFacts = facts.filter((fact) => ![...CONTACT, 'Screening'].includes(fact.section))
  const screening = facts.filter((fact) => fact.section === 'Screening')

  function loadDraft(value) {
    setDraft(value)
    setSelection(value?.resume_fact_ids || [])
    setAnswers(value?.answers || [])
    setDirty(false)
    setConfirmed(false)
    setSubmitted(false)
  }

  useEffect(() => {
    let active = true
    api.get(route).then(({ data }) => {
      if (!active) return
      setJob(data)
      setDescription(data.draft?.description || data.description)
      loadDraft(data.draft)
    }).catch((reason) => { if (active) setError(errorText(reason)) })
    return () => { active = false }
  }, [route, facts])

  function changeSelection(next, nextAnswers) {
    setSelection(next)
    setAnswers(nextAnswers)
    setDirty(true)
    setConfirmed(false)
    setSubmitted(false)
  }

  async function write(endpoint, value, method = 'post') {
    const { data } = await api[method](`${route}/${endpoint}`, value)
    loadDraft(data)
    await refreshQueue()
  }

  async function download() {
    const { data } = await api.get(`${route}/resume.pdf`, { responseType: 'blob' })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tailored-resume.pdf'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (error) return <Card><p role="alert">{error}</p></Card>
  if (!job) return <Card><p>Loading job…</p></Card>

  return (
    <Card>
      <Heading strong>{job.title} · {job.company}</Heading>
      {job.url && <Link href={job.url} target="_blank" rel="noopener noreferrer">Open employer posting</Link>}
      <HiringDetails route={route} />
      {job.tracked && <p>This requisition is already in Applications.</p>}
      {!!job.similar_applications && <p>Review {job.similar_applications} tracked applications with the same employer and title.</p>}
      <p><label htmlFor="india-posting">Posting text</label></p>
      <Textarea id="india-posting" value={description} onChange={setDescription} maxLength={16000} rows={5} disabled={!!busy} />
      <p><label>Matching provider <select value={provider} disabled={!!busy} onChange={(event) => {
        setProvider(event.target.value); setConsent(false); setModel(event.target.value === 'gemini' ? 'gemini-3.5-flash-lite' : '')
      }}>
        <option value="local">Local keyword matching (no model)</option>
        <option value="ollama">Local Ollama</option>
        <option value="openrouter">Hosted OpenRouter</option>
        <option value="gemini">Google AI Studio (Gemini)</option>
      </select></label></p>
      {provider !== 'local' && <Input ariaLabel="Model name" placeholder="Model name" value={model} onChange={setModel} disabled={!!busy} />}
      {hosted && <p><label><input type="checkbox" checked={consent} disabled={!!busy}
        onChange={(event) => setConsent(event.target.checked)} /> Send this posting text to {provider === 'gemini' ? 'Google AI Studio' : 'OpenRouter'} for one run.</label></p>}
      <Button disabled={!!busy || !facts.length || !description.trim() || (provider !== 'local' && !model.trim()) || (hosted && !consent)}
        onClick={() => run('match', async () => {
          await write('match', { description, provider, model, hosted_consent: consent })
          setConsent(false)
        })}>{busy === 'match' ? 'Matching…' : 'Generate draft'}</Button>
      {draft?.stale && <p>Verified facts or the posting changed. Generate a fresh draft.</p>}
      {draft && !draft.stale && (
        <>
          <Heading strong>Match score {draft.analysis.score}/100</Heading>
          <p>Role {draft.analysis.points.role}/20 · Location {draft.analysis.points.location}/20 · Requirements {draft.analysis.points.requirements}/60</p>
          <p>{draft.analysis.location_reason || 'Location falls outside the target regions'}</p>
          <ul>{draft.analysis.evidence.map(({ requirement, fact_id: id }) =>
            <li key={requirement}>{requirement} · {factById.has(id) ? `Evidence: ${factById.get(id).text}` : 'No verified evidence found'}</li>)}</ul>
          <Heading strong>Resume facts</Heading>
          <p>Select 6 to 12 facts. The PDF uses the text below.</p>
          <ul>{cvFacts.map((fact) => (
            <li key={fact.id}><label><input type="checkbox" checked={selection.includes(fact.id)}
              disabled={!!busy || (!selection.includes(fact.id) && selection.length >= 12)}
              onChange={(event) => changeSelection(event.target.checked ? [...selection, fact.id] : selection.filter((id) => id !== fact.id), answers)} />
              {fact.section} · {fact.text}</label> <small>({fact.source})</small></li>
          ))}</ul>
          <Heading strong>Screening answers</Heading>
          <p>Add the exact form question. Choose a verified answer or leave it blank for browser review.</p>
          {answers.map((answer, index) => (
            <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBlock: 4 }}>
              <Input ariaLabel={`Question ${index + 1}`} value={answer.question} maxLength={360} disabled={!!busy}
                onChange={(question) => changeSelection(selection, answers.map((item, i) => i === index ? { ...item, question } : item))} />
              <select aria-label={`Verified answer ${index + 1}`} value={answer.fact_id || ''} disabled={!!busy}
                onChange={(event) => changeSelection(selection, answers.map((item, i) => i === index ? { ...item, fact_id: event.target.value || null } : item))}>
                <option value="">Leave blank</option>
                {screening.map((fact) => <option key={fact.id} value={fact.id}>{fact.text}</option>)}
              </select>
              <Button disabled={!!busy} onClick={() => changeSelection(selection, answers.filter((_, i) => i !== index))}>Remove question</Button>
            </div>
          ))}
          <Button disabled={!!busy || answers.length >= 15} onClick={() => changeSelection(selection, [...answers, { question: '', fact_id: null }])}>Add question</Button>{' '}
          <Button disabled={!!busy || !dirty || answers.some((answer) => !answer.question.trim())}
            onClick={() => run('draft', () => write('draft', { revision: draft.revision, resume_fact_ids: selection, answers }, 'put'))}>Save draft edits</Button>
          <p><Button disabled={!!busy || dirty || selection.length < 6} onClick={() => run('pdf', download)}>Download two-page PDF</Button></p>
          <p><label><input type="checkbox" checked={confirmed} disabled={!!busy || dirty || draft.approved}
            onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed this job, the resume PDF, and the screening answers.</label></p>
          <Button disabled={!!busy || dirty || draft.approved || !confirmed || selection.length < 6 || !!job.tracked}
            onClick={() => run('approve', () => write('approve', { revision: draft.revision, confirmed: true }))}>Approve this version</Button>{' '}
          {draft.approved && <Button disabled={!!busy} onClick={() => run('revoke', () => write('revoke'))}>Revoke approval</Button>}
          {draft.approved && !dirty && !job.tracked && (
            <>
              {job.target && <p>Open the approved posting, then use the Approved Autofill extension. Job ID <code>{jobId}</code></p>}
              <p>Attach the reviewed PDF on the employer site. For a supported Lever form, use Submit reviewed application in the extension after reviewing the completed form. For other sites, use the employer’s submit button.</p>
              <p><label><input type="checkbox" checked={submitted} disabled={!!busy}
                onChange={(event) => setSubmitted(event.target.checked)} /> I submitted this application on the employer site.</label></p>
              <Button disabled={!!busy || !submitted} onClick={() => run('track', async () => {
                const { data } = await api.post(`${route}/submitted`, { revision: draft.revision, confirmed: true })
                setJob({ ...job, tracked: data.application_id })
              })}>Log submitted application</Button>
            </>
          )}
        </>
      )}
    </Card>
  )
}


function RankedJobs({ facts }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const names = new Map(facts.map(({ id, text }) => [id, text]))

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const { data } = await api.get(`${PATH}/shortlist`)
      setResult(data)
    } catch {
      setError('Could not load ranked jobs.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <Card>
      <Heading strong>CV-ranked jobs</Heading>
      <p>Latest 200 new or saved jobs, ranked locally by verified CV evidence.</p>
      <Button disabled={busy} onClick={refresh}>Refresh ranking</Button>
      {error && <p role="status">{error}</p>}
      {result && !result.ready && <p>Save verified CV facts, then refresh the ranking.</p>}
      {result?.ready && (
        <ol>{result.jobs.map((job) => (
          <li key={job.job_id} style={{ marginBlock: 8 }}>
            <RouterLink to={`/application-queue/${job.job_id}`}>{job.title}</RouterLink>
            {' · '}{job.company} · {job.score === null ? 'Insufficient posting text' : `${job.score}/100`}
            {job.evidence.length > 0 && (
              <details>
                <summary>Matching evidence</summary>
                <ul>{job.evidence.map(({ requirement, fact_id: id }) => (
                  <li key={requirement}>{requirement} · {names.get(id) || 'No verified evidence found'}</li>
                ))}</ul>
              </details>
            )}
          </li>
        ))}</ol>
      )}
    </Card>
  )
}
