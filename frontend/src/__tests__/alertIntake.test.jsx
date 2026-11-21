import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api'
import AlertIntake from '../screens/AlertIntake'

vi.mock('../api', () => ({ default: { post: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('previews an alert and imports only after confirmation', async () => {
  const url = 'https://www.linkedin.com/jobs/view/123'
  api.post.mockResolvedValueOnce({ data: { jobs: [{ url, title: 'Director of AI', portal: 'LinkedIn' }] } })
    .mockResolvedValueOnce({ data: { added: 1 } })
  render(<AlertIntake />)
  fireEvent.change(screen.getByLabelText('Job alert text'), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview alert' }))
  const save = await screen.findByRole('button', { name: 'Import job for review' })
  expect(api.post.mock.calls).toEqual([['/india-workflow/alerts/preview', { text: url }]])
  fireEvent.change(screen.getByLabelText('location'), { target: { value: 'Gurugram' } })
  fireEvent.click(save)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Added to Jobs' })).toBeTruthy())
  expect(api.post).toHaveBeenLastCalledWith('/india-workflow/alerts/import', {
    url, title: 'Director of AI', company: '', location: 'Gurugram', description: '',
  })
})
