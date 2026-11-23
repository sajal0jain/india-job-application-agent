import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api'
import ApplicationQueue from '../screens/ApplicationQueue'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('requires a separate review and submitted confirmation', async () => {
  const jobId = '11111111-2222-3333-4444-555555555555'
  const prefix = '/india-workflow'
  const route = `${prefix}/jobs/${jobId}`
  const facts = Array.from({ length: 6 }, (_, i) => ({ id: String(i), section: 'Experience', text: `Fact ${i}`, source: 'Sample CV' }))
  const draft = { revision: 'c'.repeat(64), resume_fact_ids: facts.map((fact) => fact.id), answers: [],
    analysis: { score: 50, points: { role: 20, location: 20, requirements: 10 }, evidence: [] } }
  api.get.mockImplementation(async (path) => ({ data: ({
    [`${prefix}/profile`]: { facts }, [`${prefix}/queue`]: [],
    '/jobs': { jobs: [] }, [route]: { title: 'Director of AI', company: 'Sample', description: 'Sample posting', draft },
  })[path] }))
  api.post.mockResolvedValueOnce({ data: { ...draft, approved: true } })
    .mockResolvedValueOnce({ data: { application_id: 'recorded' } })
  render(<MemoryRouter initialEntries={[`/application-queue/${jobId}`]}>
    <Routes><Route path="/application-queue/:jobId" element={<ApplicationQueue />} /></Routes>
  </MemoryRouter>)
  await screen.findByText('Match score 50/100')
  const approval = screen.getByRole('button', { name: 'Approve this version' })
  expect(approval.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(screen.getByLabelText(/I reviewed this job/))
  fireEvent.click(approval)
  await screen.findByText(/Attach the reviewed PDF/)
  expect(api.post).toHaveBeenCalledTimes(1)
  const track = screen.getByRole('button', { name: 'Log submitted application' })
  expect(track.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(screen.getByLabelText(/I submitted this application/))
  fireEvent.click(track)
  await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(`${route}/submitted`, {
    revision: draft.revision, confirmed: true,
  }))
})

it('loads a posting, prepares a draft after review, and opens the matching job', async () => {
  const prefix = '/india-workflow'
  const id = 'new-job'
  const posting = { url: 'https://jobs.lever.co/sample/role', title: 'Director of AI',
    company: 'Sample', location: 'Gurugram', description: 'Lead AI model validation.' }
  api.get.mockImplementation(async (path) => ({ data: ({
    [`${prefix}/profile`]: { facts: [{ id: 'one', section: 'Experience', text: 'Led analytics', source: 'CV' }] },
    [`${prefix}/queue`]: [], '/jobs': { jobs: [] }, [`${prefix}/jobs/${id}`]: posting,
  })[path] }))
  api.post.mockResolvedValueOnce({ data: posting }).mockResolvedValueOnce({ data: { job_id: id, draft_created: true } })

  render(<MemoryRouter initialEntries={['/application-queue']}>
    <Routes><Route path="/application-queue/:jobId?" element={<ApplicationQueue />} /></Routes>
  </MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Job posting URL'), { target: { value: posting.url } })
  fireEvent.click(screen.getByRole('button', { name: 'Load posting' }))
  expect((await screen.findByLabelText('Job description from posting')).value).toBe(posting.description)
  expect(api.post).toHaveBeenCalledExactlyOnceWith(`${prefix}/posting/preview`, { url: posting.url })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare tailored draft' }))
  await screen.findByText('Director of AI · Sample')
  expect(api.post).toHaveBeenLastCalledWith(`${prefix}/posting/prepare`, posting)
})
