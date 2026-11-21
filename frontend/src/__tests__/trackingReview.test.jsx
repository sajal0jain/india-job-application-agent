import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api'
import TrackingReview from '../screens/TrackingReview'

vi.mock('../api', () => ({ default: { post: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('previews requisition matches and requires an explicit status choice', async () => {
  const text = 'Requisition ID: JR-12345'
  api.post.mockResolvedValueOnce({ data: {
    classification: 'rejection', applications: [{ id: 'one', company: 'Example', title: 'Director of AI', status: 'interview' }],
  } }).mockResolvedValueOnce({ data: { status: 'rejected' } })
  const onConfirmed = vi.fn()
  render(<TrackingReview onConfirmed={onConfirmed} />)
  fireEvent.click(screen.getByText('Email review and hiring outcomes'))
  fireEvent.change(screen.getByLabelText('Recruiter email'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview email match' }))
  const confirm = await screen.findByRole('button', { name: 'Confirm status update' })
  expect(confirm.getAttribute('aria-disabled')).toBe('true')
  expect(api.post.mock.calls).toEqual([['/india-workflow/tracking/email-preview', { text }]])
  fireEvent.change(screen.getByLabelText('Application to update'), { target: { value: 'one' } })
  fireEvent.change(screen.getByLabelText('Confirmed status'), { target: { value: 'rejected' } })
  fireEvent.click(confirm)
  await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce())
  expect(api.post).toHaveBeenLastCalledWith('/india-workflow/tracking/email-confirm', {
    application_id: 'one', expected_status: 'interview', status: 'rejected', confirmed: true,
  })
})
