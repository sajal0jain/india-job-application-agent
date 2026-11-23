// Chrome serializes this function into the active tab. Keep all dependencies inside it.
function fillApprovedFields(target, fields) {
  const path = location.pathname.replace(/\/$/, '').replace(/\/(?:application|apply)$/, '')
  if (location.origin !== target.origin || path !== target.path || location.search !== target.search) {
    return { filled: 0, error: 'The tab moved away from the approved posting.' }
  }
  const normalize = (label) => label.replace(/[\s*:]+/g, ' ').trim().toLowerCase()
  const approved = new Map()
  for (const { label, value } of fields) {
    const key = normalize(label)
    // Conflicting labels are ambiguous, so leave these for manual input.
    approved.set(key, approved.has(key) ? null : value)
  }
  const controls = new Map()
  for (const control of document.querySelectorAll('form input, form textarea')) {
    if (control.disabled || control.readOnly || control.value || !control.getClientRects().length) continue
    if (!['text', 'email', 'tel', 'url', 'textarea'].includes(control.type)) continue
    const labels = Array.from(control.labels || [], (label) => label.textContent).filter(Boolean)
    const key = normalize(control.getAttribute('aria-label') || labels.join(' '))
    if (!approved.get(key)) continue
    controls.set(key, controls.has(key) ? null : control)
  }
  let filled = 0
  for (const [key, control] of controls) {
    if (!control || !control.isConnected || control.value) continue
    const value = approved.get(key)
    if (control.maxLength >= 0 && value.length > control.maxLength) continue
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value)
    // Avoid invoking employer-side change handlers, including automatic form submission.
    filled += 1
  }
  return { filled }
}

// Only the native, single-page Lever form uses this path. The employer still
// handles validation, CAPTCHA and the submission response.
function submitReviewedLeverForm(target) {
  const pathname = location.pathname.replace(/\/$/, '')
  const fail = (error) => ({ error })
  if (target.origin !== 'https://jobs.lever.co' || location.origin !== target.origin ||
      pathname !== `${target.path}/apply` || location.search !== target.search || location.hash) {
    return fail('Open the approved Lever application form.')
  }
  const visible = (element) => element.getClientRects().length > 0
  const forms = Array.from(document.forms).filter((form) => {
    if (!visible(form) || form.method !== 'post' || form.enctype !== 'multipart/form-data' ||
        !['', '_self'].includes(form.target)) return false
    const action = new URL(form.action)
    return action.origin === location.origin && action.pathname.replace(/\/$/, '') === pathname
  })
  if (forms.length !== 1) return fail('This form needs to be submitted on the employer site.')
  const [form] = forms
  const buttons = Array.from(form.elements).filter((control) =>
    control.type === 'submit' && visible(control) && !control.matches(':disabled'))
  if (buttons.length !== 1) return fail('Could not identify a single Submit application button.')
  const [button] = buttons
  const label = (button.value || button.textContent).trim()
  if (!/^submit application$/i.test(label) ||
      ['formaction', 'formmethod', 'formenctype', 'formtarget', 'formnovalidate'].some((name) => button.hasAttribute(name))) {
    return fail('Use the employer’s submit button for this form.')
  }
  const resumes = Array.from(form.elements).filter((control) => control.type === 'file' && control.name === 'resume')
  if (resumes.length !== 1 || resumes[0].files.length !== 1 ||
      !/\.pdf$/i.test(resumes[0].files[0].name) || !form.reportValidity()) {
    return fail('Attach the reviewed résumé PDF and complete the required fields first.')
  }
  const attempt = `jobnavigator:submitted:${pathname}`
  if (sessionStorage.getItem(attempt)) {
    return fail('A submission was already attempted in this tab. Check the employer response before taking further action.')
  }
  sessionStorage.setItem(attempt, '1')
  button.click()
  return { attempted: true }
}
