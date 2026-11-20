# India job search agent

## Foundation and gaps

Reviewed three default-branch snapshots on 20 November 2026.

| Project | Snapshot and evidence | Decision |
| --- | --- | --- |
| [JobNavigator](https://github.com/vesaias/JobNavigator/tree/c9ac55f82bde34a22f6a1fc9b9aeca34196b9427) | MIT. 18 Nov. FastAPI, React/Vite, PostgreSQL 16, Playwright, Caddy, Docker images, backend and frontend CI. Existing ATS adapters, scoring reports, PDF/DOCX rendering, application state and dedup, and Chrome extension. Python pins include a GitHub-hosted LinkedIn fork and the browser build is substantial. | Reuse as the foundation. Add India targeting, evidence validation and a versioned approval workflow. Restrict the source and autofill paths used for this workflow. |
| [Resume Matcher](https://github.com/srbhr/Resume-Matcher/tree/959e4587dab33d7ff849d822b8182e11e7669dfc) | Apache 2.0. 16 Nov. FastAPI, Next.js, SQLite with a PostgreSQL option, LiteLLM, Playwright, Docker documentation, tests and publishing workflow. Master CV, tailored variants and deterministic ATS PDF text round-trip checks. | Reference its PDF parsing and ATS checks. Preserve Apache notices for any future code reuse. The inspected workflow is resume-focused. |
| [VedantSagare agent](https://github.com/VedantSagare/job-application-agent/tree/7b8a2a2a82910d1229cfc058956c560af3e8b250) | 17 Nov. No license found at this revision. FastAPI, React/Vite, SQLite, Claude, Playwright and a Windows batch launcher. No Docker setup or automated test workflow found. India-focused sources and supervised filling, but the one-page tailoring code can suggest skills absent from the master CV. | Reference behavior only. No code imported. |

Commit dates are activity signals. Phase 1 is the baseline, and the controls below are planned acceptance criteria.

1. **Baseline.** Build from the pinned JobNavigator checkout. Verify the gateway, database, login, manual job intake, duplicate handling and tracker using synthetic data. Keep the extension unloaded, scheduled jobs disabled and provider keys unset.
2. **Discovery.** Reuse employer ATS adapters for employer boards that allow this access. Begin with a small allowlist of Greenhouse, Lever and Ashby employer boards and manual links. Match Analytics Manager, Senior Analytics Manager, Data Science Manager, and related BI, Decision Science and Insights manager titles. Normalize Gurugram/Gurgaon and Delhi NCR cities. Require explicit India eligibility for remote roles, and surface ambiguous cases for review. Exercise each rule with saved, synthetic fixtures. Respect published restrictions and rate limits. Keep general board automation and private account endpoints out of the workflow.
3. **Matching.** Reuse full scoring reports, but make the ranking reproducible from a weighted rubric covering role, location, leadership, domain and skills. Let AI extract requirements from untrusted posting text. Validate requirement references against the posting and candidate claims against verified fact IDs. Show matched evidence, missing information, and hard eligibility constraints.
4. **Resume and screening drafts.** Store human-verified CV facts with stable IDs, source excerpts and a revision. Have the model rank and select facts. Render from those facts in a single-column layout, preserving employers, titles, dates, credentials and metrics. Check two-page PDF output and extracted text order, and return drafts with insufficient or overflowing content for review. Leave unsupported screening answers blank and ask for input.
5. **Providers.** Reuse OpenRouter for a configurable low-cost model and Ollama as the local option. Verify pricing and retention terms before enabling a hosted model. Use explicit hosted opt-in, send only required fields, cap tokens and requests, and keep cost reporting distinct from enforced limits. Use mocked providers for tests. On Windows, try one small quantized Ollama model at a time after the baseline is stable.
6. **Approval and autofill.** Add per-job approval for the exact resume revision and individual answers. Edits revoke approval. Bind approved payloads to the job and employer origin. Reuse eligible extension field-fill logic only after a user gesture. The user will review and press the employer's final Submit button. Test stale approvals, changed domains, duplicate jobs, unknown fields and application forms with side-effecting controls using local HTML fixtures.
7. **Tracker.** Reuse application states and transitions. Prefer employer/requisition ID and canonical URL for dedup. Flag similar postings for review and preserve distinct requisitions with the same employer/title. Record submission only after the user confirms it. Test retries, repeated tracking, and concurrent attempts using PostgreSQL.

## Phase 1 on Windows

Use Git for Windows and Docker Desktop in Linux-container mode with the WSL 2 backend. Run these commands in PowerShell at the root of the development checkout. The local overlay needs Docker Compose 2.24.4 or newer. The upstream revision is `c9ac55f82bde34a22f6a1fc9b9aeca34196b9427`.

To recreate the development branch from the Phase 1 patch, open PowerShell in the directory containing the patch and run:

```powershell
git clone https://github.com/vesaias/JobNavigator.git
Set-Location JobNavigator
git switch -c dev/india-job-agent c9ac55f82bde34a22f6a1fc9b9aeca34196b9427
git am ../jobnavigator-phase1.patch
```

Create the local secrets file once. Preserve it if it already exists. Use a newly generated set for each fresh installation.

```powershell
if (-not (Test-Path .env)) {
    "POSTGRES_PASSWORD=$([guid]::NewGuid().ToString('N'))",
    "INITIAL_API_KEY=$([guid]::NewGuid().ToString('N'))" |
        Set-Content -Encoding ascii .env
}
docker compose version
docker compose -p jn-india-phase1 -f docker-compose.yml -f compose.local.yml config --quiet
docker compose -p jn-india-phase1 -f docker-compose.yml -f compose.local.yml up --build --wait --wait-timeout 150
Invoke-RestMethod http://127.0.0.1:8088/health
```

Open http://127.0.0.1:8088 and sign in with the value of `INITIAL_API_KEY` from the local file. The database is internal to Compose. Only Caddy publishes a loopback port. Keep `.env` local. If the dashboard key changes in the UI, the database saves the new key. PostgreSQL initial credentials apply when a new volume is initialized.

The overlay disables scheduled tasks, telemetry, and the Docker-socket runner manager. It still uses upstream startup behavior, including an OpenRouter public pricing lookup. Leave the upstream search presets unused until approved discovery sources are configured. Keep live CVs and provider credentials out of this baseline.

To stop while keeping the database, run:

```powershell
docker compose -p jn-india-phase1 -f docker-compose.yml -f compose.local.yml stop
```

On a disposable test database, run `python tests/tools/india_agent_smoke.py` from the checkout. The test uses the initial key from the local file and creates uniquely named synthetic job and tracking records. It exercises the local tracker API and sends no job application.

## Phase 1 verification

- The Compose configuration resolves to four default services and publishes only Caddy on loopback. The runner manager is inactive.
- PostgreSQL returned `1` for a test query. The published frontend image served HTML through Caddy in the Linux environment.
- 189 selected upstream backend tests passed with SQLite, including authentication, manual intake, deduplication, application tracking, location and operations tests. A separate test invocation used temporary runner account directories because the cloud home directory is read-only.
- The Linux source build and published backend image extraction hit the workspace storage limit. The initial build also required the cloud proxy CA, which was used only in a temporary build context. The full Docker smoke test and Windows validation are pending.
