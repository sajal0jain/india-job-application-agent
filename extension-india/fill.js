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
