import script from '../../../extension-india/fill.js?raw'
import { expect, it, vi } from 'vitest'

const fillApprovedFields = new Function(script + '\nreturn fillApprovedFields')()

it('fills only unique approved empty text controls and never submits', () => {
  document.body.innerHTML = `
    <form>
      <label>Email<input type="email"></label>
      <label>Full name<input value="Already entered"></label>
      <label>Notice period<textarea></textarea></label>
      <label>Notice period<input></label>
      <label>CV<input type="file"></label>
      <label>Unknown field<input></label>
      <button type="submit">Submit</button>
    </form>
  `
  document.querySelectorAll('input, textarea').forEach((control) => {
    control.getClientRects = () => [{ width: 10, height: 10 }]
  })
  const submit = vi.fn((event) => event.preventDefault())
  const form = document.querySelector('form')
  form.addEventListener('submit', submit)
  form.addEventListener('input', () => form.requestSubmit())
  const target = { origin: location.origin, path: location.pathname.replace(/\/$/, ''), search: location.search }
  const fields = [
    { label: 'Email', value: 'sample@example.invalid' },
    { label: 'Full name', value: 'Changed' },
    { label: 'Notice period', value: '30 days' },
    { label: 'CV', value: 'resume.pdf' },
  ]

  expect(fillApprovedFields({ ...target, path: '/another-job' }, fields).filled).toBe(0)
  expect(fillApprovedFields(target, fields)).toEqual({ filled: 1 })
  expect(document.querySelector('input[type="email"]').value).toBe('sample@example.invalid')
  expect(document.querySelector('input[value]').value).toBe('Already entered')
  expect(document.querySelector('textarea').value).toBe('')
  expect(document.querySelector('input[type="file"]').value).toBe('')
  expect(submit).not.toHaveBeenCalled()
})

it('submits a reviewed Lever fixture once and refuses other postings or missing attachments', () => {
  const target = { origin: 'https://jobs.lever.co', path: '/sample/abc-123', search: '' }
  const page = { origin: target.origin, pathname: target.path + '/apply', search: '', hash: '' }
  const submit = new Function('location', script + '\nreturn submitReviewedLeverForm')(page)
  document.body.innerHTML = `
    <form method="post" enctype="multipart/form-data" action="https://jobs.lever.co/sample/abc-123/apply">
      <input type="file" name="resume"><button type="submit">Submit application</button>
    </form>
  `
  const form = document.querySelector('form')
  const button = form.querySelector('button')
  const onSubmit = vi.fn((event) => event.preventDefault())
  form.addEventListener('submit', onSubmit)
  form.getClientRects = button.getClientRects = () => [{ width: 10, height: 10 }]
  sessionStorage.clear()
  expect(submit({ ...target, path: '/another-posting' }).error).toBeTruthy()
  expect(submit(target).error).toMatch(/Attach/)
  Object.defineProperty(form.elements.resume, 'files', { value: [new File(['pdf'], 'resume.pdf')] })
  expect(submit(target)).toEqual({ attempted: true })
  expect(submit(target).error).toMatch(/already attempted/)
  expect(onSubmit).toHaveBeenCalledTimes(1)
})
