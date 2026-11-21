# India job search agent

## Foundation and gaps

Reviewed three default-branch snapshots on 20 November 2026.

| Project | Snapshot and evidence | Decision |
| --- | --- | --- |
| [JobNavigator](https://github.com/vesaias/JobNavigator/tree/c9ac55f82bde34a22f6a1fc9b9aeca34196b9427) | MIT. 18 Nov. FastAPI, React/Vite, PostgreSQL 16, Playwright, Caddy, Docker images, backend and frontend CI. Existing ATS adapters, scoring reports, PDF/DOCX rendering, application state and dedup, and Chrome extension. Python pins include a GitHub-hosted LinkedIn fork and the browser build is substantial. | Reuse as the foundation. Add India targeting, evidence validation and a versioned approval workflow. Restrict the source and autofill paths used for this workflow. |
| [Resume Matcher](https://github.com/srbhr/Resume-Matcher/tree/959e4587dab33d7ff849d822b8182e11e7669dfc) | Apache 2.0. 16 Nov. FastAPI, Next.js, SQLite with a PostgreSQL option, LiteLLM, Playwright, Docker documentation, tests and publishing workflow. Master CV, tailored variants and deterministic ATS PDF text round-trip checks. | Reference its PDF parsing and ATS checks. Preserve Apache notices for any future code reuse. The inspected workflow is resume-focused. |
| [VedantSagare agent](https://github.com/VedantSagare/job-application-agent/tree/7b8a2a2a82910d1229cfc058956c560af3e8b250) | 17 Nov. No license found at this revision. FastAPI, React/Vite, SQLite, Claude, Playwright and a Windows batch launcher. No Docker setup or automated test workflow found. India-focused sources and supervised filling, but the one-page tailoring code can suggest skills absent from the master CV. | Reference behavior only. No code imported. |

Commit dates are activity signals. The numbered phases record the original design. See the implementation notes below for the available workflow.

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

## Phase 2 discovery

Open **Searches → India leadership discovery** and enter up to three employer
board homepages from Greenhouse, Lever, or Ashby. Use a board only after
confirming the employer permits automated access. These are example URL shapes:

- `https://job-boards.greenhouse.io/<employer>`
- `https://jobs.lever.co/<employer>`
- `https://jobs.ashbyhq.com/<employer>`

Choose **All levels**, **Director and Head**, or **Manager and Senior Manager**,
then click **Preview jobs**. The search covers AI, machine learning, analytics,
data science, decision science, business intelligence, and related insights roles.
The match reasons come from the title and the location metadata supplied by the
employer feed. Gurugram and Gurgaon refer to the same target city. International
remote roles qualify when the feed explicitly lists India or worldwide remote
work with no location restriction. General remote listings need review. A city or country restriction in the actual posting can be more
specific. Open the employer's posting and confirm eligibility before saving a job,
especially when the preview flags it for review.

A preview fetches the selected boards once and lists up to 200 candidates. Board
URLs are entered for each visit. The preview does not write jobs or run in the
background. **Save to Jobs** adds only the selected posting to the existing feed.
The employer name uses the board slug in this preview. For other employer sites,
open **Applications → Log application**, enter the posting link, and choose **New** or **Saved** to add it to the feed.

On Windows, pull the development branch and rebuild from your checkout to pick
up the backend and dashboard changes:

```powershell
git pull --ff-only
docker compose -p jn-india-phase1 -f docker-compose.yml -f compose.local.yml up --build --wait --wait-timeout 150
```

## Verified application workflow

1. Open **Application queue → Verified master CV facts**. Add your name,
   email or phone, and at least six substantive CV facts. Record the source
   of every claim and confirm you checked it. Add answers such as notice
   period or work authorization as **Screening** facts. This facts list is
   separate from the upstream Resumes and Persona pages.
2. Save a job to the feed. Open it from **Application queue → Saved jobs**,
   check the posting text, and generate a draft. **Local keyword matching**
   works without a model. The score shows role fit (20 points), location
   (20), and requirement evidence (60). Each requirement shows a source
   fact or a gap. Confirm eligibility on the employer site.
3. Review the selected CV facts. Enter exact screening questions and map
   them to verified answers. Leave unsupported answers blank. Save the
   draft, download and review the two-page PDF, then approve that version.
   The renderer validates page count and extracted fact order. Editing the
   draft or master facts revokes approval. A changed posting requires a
   fresh draft.
4. Open the employer posting. Attach the reviewed PDF and submit yourself.
   Select **Log submitted application** only after the employer confirms it.
   The record appears in **Applications**. The queue blocks duplicate records
   for the same requisition and flags tracked jobs with the same employer and
   title for review.

### Optional AI

- **OpenRouter.** Add your key under **Settings → Models**. Select Hosted
  OpenRouter in the queue, enter a model ID, and consent for each run.
  [OpenRouter model pricing](https://openrouter.ai/models) lists available
  prices. The workflow sends only posting text, up to 12,000 characters.
  Remove private notes from that text before opting in. The model extracts
  verbatim posting requirements. CV facts and screening answers stay local.
  The queue caps output at 600 tokens and permits 10 AI attempts per account
  per UTC day without automatic fallback. Billing follows provider pricing.
- **Ollama.** Run Ollama on Windows and pull a small model. Configure the
  endpoint in **Settings → Models**, or set
  `OLLAMA_BASE_URL=http://host.docker.internal:11434` in the local `.env`
  and recreate the backend. Choose Ollama in the queue and enter the model's
  exact tag. [Ollama for Windows](https://docs.ollama.com/windows)

### Optional approved autofill

Use **JobNavigator Approved Autofill** in Chrome or Edge. From Extensions,
enable Developer mode, choose Load unpacked, and select `extension-india/`.
The local Docker setup disables the upstream autofill API.

Open the approved Greenhouse, Lever, or Ashby posting in the active tab. In
the popup, enter the Job ID shown in the queue, the dashboard port, and the
current dashboard key. The extension uses the key for the loopback request
and does not store it. Click **Fill approved fields**. The server rechecks
approval and posting identity. The browser checks that the tab still matches.

The extension fills empty, visible, uniquely labelled text controls in the
active document. Dropdowns, file uploads, embedded forms, and unsupported
sites are manual. It sets values without dispatching input events, so some
sites may require you to re-enter values. It presses no employer controls.
Use it only on employer pages that permit autofill.

## Recurring portal and employer discovery

**Searches → India leadership discovery → Automatic search** reports configured
sources and the most recent sweep. The dashboard owner can run the configured
sources on demand. The scheduled search runs while Docker and the backend are
running. It starts on boot when enabled and repeats after the configured interval.
The coverage report resets when the backend restarts. Jobs are stored locally.

Add only the entries you need to the existing, private `.env`:

```dotenv
JN_INDIA_SWEEP_HOURS=24
JN_INDIA_PORTAL_PAGES=2
JN_INDIA_EMPLOYER_BOARDS=https://jobs.lever.co/thinkahead,https://jobs.lever.co/netomi,https://jobs.lever.co/paytm,https://jobs.ashbyhq.com/g2,https://blackrock.wd1.myworkdayjobs.com/blackrock_professional
# Add either or both sets once authorized:
# ADZUNA_APP_ID=
# ADZUNA_APP_KEY=
# JOOBLE_API_KEY=
```

The employer entries are starting points for companies with a Gurugram hiring
presence. Confirm that each employer permits the intended access before adding
it. Add further Greenhouse, Lever, Ashby and Workday employer homepages to
expand coverage. The sweep checks every configured board in order. Workday
access uses ordinary HTTPS and stops on a block or rate limit. The report
flags unavailable or partial feeds. This catalog is an allowlist, and coverage
depends on the employer pages you add, the jobs published to those feeds, and
the regions the feeds report.

[Adzuna's API](https://developer.adzuna.com/docs/search) supports personal job search under
its [API terms](https://developer.adzuna.com/docs/terms_of_service).
For [Jooble](https://in.jooble.org/api/about), obtain a key authorized for the
India integration and your use. The portal search uses role queries across
Gurgaon, Gurugram, Delhi NCR and nationwide remote terms. At two pages per
query, each portal may receive up to 96 requests per sweep. Set a frequency
and page count that fit your provider quota. A portal error stops that portal
for the rest of the run. Unconfigured portals receive no requests.

The sweep adds candidates under **Jobs** with source labels. A location marked
for review needs confirmation on the employer posting. Keep other portals
and unsupported career sites on manual intake when automated access is
unavailable. No sweep starts an application or sends candidate data.

After editing `.env`, apply it using the usual Docker command:

```powershell
docker compose -p jn-india-phase1 -f docker-compose.yml -f compose.local.yml up --build --wait --wait-timeout 150
```

Set `JN_INDIA_SWEEP_HOURS=0` and recreate the backend to turn off recurring
runs. The manual configured-source button remains available.

### Remote-only job feed

Set `JN_INDIA_REMOTIVE=1` in your local `.env` to add
[Remotive](https://remotive.com/remote-jobs/api) to the same sweep, without an
API key. Set `JN_INDIA_SWEEP_HOURS=24` for daily automation, or leave it at
`0` to trigger the feed manually. Recreate the backend to apply the changes.

The feed keeps matching leadership roles with explicit India or worldwide
eligibility. It flags unclear geography for review and skips recognizable
foreign-only restrictions. Listings retain their original Remotive links and
source labels. The feed is refreshed at most once every six hours. Remotive
delays public listings by 24 hours.

## Job alerts and CV ranking

**Searches → Import job alerts** accepts pasted alert content or an email
saved as `.eml`. Preview the recognized LinkedIn, Naukri, Foundit, and
Instahyre direct posting links, correct their titles, add employer and
location, and optionally paste the posting text. Import each relevant job
for review. The preview works on the submitted file or text and does not
follow links or connect to a mailbox. For wrapped links, paste the direct
posting URL after opening it yourself.

**Application queue → CV-ranked jobs** computes a local ranking on opening
or refreshing the page. It covers the latest 200 new or saved jobs and uses
the current verified CV facts. Short descriptions are flagged as
insufficient posting text. Where a feed includes posting excerpts, new
imports retain them. If a job has no description, open it and paste the
employer's posting text to generate and review a draft. Ranking does not
approve applications or generate PDFs automatically.

## Employer watchlist, hiring details, and email review

- **Searches → India leadership discovery → Automatic search → Edit employer
  watchlist.** The owner can paste approved employer board URLs, one per
  line. The first edit starts from the configured `.env` list. Saving writes
  the replacement list to the local database. Future sweeps use that saved
  list, including an intentionally empty list. Open the sweep report to see
  per-board results.
- **Application queue → open a job → Review India hiring details.** Record
  employer-stated fixed and variable CTC, accepted notice period, buyout,
  workplace policy, team remit, and the source. Leave unknown values blank.
  These fields are local notes and are separate from your verified facts and
  approved autofill payload.
- **Applications → Email review and hiring outcomes.** Paste a recruiter
  message containing a job or requisition ID. Preview the matching tracked
  records, choose the application and its new status, then confirm.
  The preview uses the text you supply and does not connect to a mailbox.
  Existing Gmail reconciliation checks explicit requisition IDs when present.
  The outcome counts show current stages and the last recorded stage before
  rejection. Older records without that transition appear as Unknown.
