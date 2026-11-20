import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api'
import IndiaDiscovery from '../screens/IndiaDiscovery'

vi.mock('../api', () => ({ default: { post: vi.fn() } }))
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
