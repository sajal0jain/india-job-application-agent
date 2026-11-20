const form = document.querySelector('#fill')
const status = document.querySelector('#status')
const button = form.querySelector('button')

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  button.disabled = true
  status.textContent = ''
  const { job, port, key } = form.elements
  const jobId = job.value.trim()
  const apiKey = key.value
  key.value = ''
  try {
    if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('Copy the job ID from Application queue.')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url?.startsWith('https://')) throw new Error('Open the approved employer posting first.')
    const response = await fetch(`http://127.0.0.1:${port.value}/api/india-workflow/jobs/${jobId}/fill`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_url: tab.url }),
      cache: 'no-store',
    })
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Autofill request was rejected.')
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: fillApprovedFields, args: [data.target, data.fields],
    })
    status.textContent = result.error || `Filled ${result.filled} fields. Complete any remaining fields and review before submitting.`
  } catch (error) {
    status.textContent = error.message || 'Could not reach the dashboard.'
  } finally {
    button.disabled = false
  }
})
