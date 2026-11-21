import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import api from '../api'
import Resumes from '../screens/Resumes'

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('chooses a base, starts an evidence-only run, and opens the copy from that run', async () => {
  api.get.mockImplementation(async (url) => {
    if (url === '/resumes/shelf') {
      return { data: { bases: [{ id: 'one', name: 'General' }, { id: 'two', name: 'Executive' }] } }
    }
    if (url === '/monitor/run/run-1') {
      return { data: { status: 'completed', meta: { created: { resume_id: 'copy-1' } } } }
    }
    return { data: [] }
  })
  api.post.mockResolvedValue({ data: { run_id: 'run-1' } })

  function Editor() {
    return <div>Editing {useParams().id}</div>
  }

  render(<MemoryRouter initialEntries={['/resumes']}><Routes>
    <Route path="/resumes" element={<Resumes />} />
    <Route path="/resumes/:id" element={<Editor />} />
  </Routes></MemoryRouter>)

  await screen.findByText('Executive')
  fireEvent.click(screen.getByRole('button', { name: 'Tailor from job description' }))
  fireEvent.click(screen.getByLabelText('Base résumé'))
  fireEvent.click(screen.getByRole('option', { name: 'Executive' }))
  fireEvent.change(screen.getByLabelText('Job description'), { target: { value: '  Lead an AI team.  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create tailored résumé' }))

  expect(api.post).toHaveBeenCalledExactlyOnceWith('/resumes/tailor', {
    base_resume_id: 'two', job_description: 'Lead an AI team.', evidence_only: true,
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Open tailored résumé' }))
  expect(await screen.findByText('Editing copy-1')).toBeTruthy()
})
