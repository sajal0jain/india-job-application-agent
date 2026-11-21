import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api'
import IndiaDiscovery, { JobSearch } from '../screens/IndiaDiscovery'

vi.mock('../api', () => ({ default: { post: vi.fn(), get: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('previews Director roles and saves only after the user chooses a posting', async () => {
  const board = 'https://jobs.lever.co/example'
  const job = {
    title: 'Director of AI', company: 'example', url: `${board}/123`,
    level: 'Director', location: 'Remote', decision: 'review',
    reason: 'Remote eligibility for India needs confirmation',
  }
  api.post.mockResolvedValueOnce({ data: { total: 1, jobs: [job], errors: [] } })
  api.post.mockResolvedValueOnce({ data: { created: true } })

  render(<IndiaDiscovery />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Employer board 1' }), {
    target: { value: board },
  })
  fireEvent.click(screen.getByLabelText('Seniority'))
  fireEvent.click(screen.getByRole('option', { name: 'Director and Head' }))
  fireEvent.click(screen.getByRole('button', { name: 'Preview jobs' }))

  await screen.findByRole('link', { name: 'Director of AI' })
  expect(screen.getByText(/Review needed/)).toBeTruthy()
  expect(api.post.mock.calls).toEqual([['/india-discovery/preview', {
    boards: [board], level: 'Director',
  }]])

  fireEvent.click(screen.getByRole('button', { name: 'Save to Jobs' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Saved to Jobs' })).toBeTruthy())
  expect(api.post).toHaveBeenLastCalledWith('/jobs/manual', {
    title: job.title, company: job.company, url: job.url, location: job.location,
    status: 'saved', dedup_by_posting: true,
  })
})


it('runs the simple search without configuring boards and displays recent discoveries', async () => {
  let status = { boards: 0, portals: [], enabled_hours: 0, running: false, last: null }
  api.get.mockImplementation(async (path) => ({ data: path === '/jobs'
    ? { jobs: [{ id: '123', title: 'Director of AI', company: 'Example', location: 'Remote India' }] }
    : status }))
  api.post.mockImplementation(async () => {
    status = { ...status, last: {
      finished_at: '2026-11-21T00:00:00Z', sources: [{ source: 'Remotive', added: 1 }],
    } }
    return { data: status }
  })

  render(<JobSearch />)
  await screen.findByText(/Remotive is ready to search/)
  fireEvent.click(screen.getByRole('button', { name: 'Find jobs' }))
  expect(api.post).toHaveBeenCalledWith('/india-discovery/sweep?include_remote=true')
  expect(await screen.findByRole('link', { name: 'Director of AI' })).toHaveProperty('pathname', '/application-queue/123')
  expect(await screen.findByText('1 new job added.')).toBeTruthy()
})
