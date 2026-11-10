# Swiss Outreach Module (Maestro)

Server-side Swiss company outreach pipeline: ZEFIX search, website enrichment, scoring, email generation/sending, and approval APIs.

Contracts (types, schema-defs, validators, prompts) live in **armonia** at `armonia/src/modules/swissOutreach/`. This module implements the runtime layer.

Enable via `ENABLED_MODULES=core,swissOutreach`. Configure with `SWISS_OUTREACH_*` env vars — see `utilities/config.ts` and [`docs/swiss-outreach/INSTALL.md`](../../../docs/swiss-outreach/INSTALL.md).

Platform docs: [`docs/swiss-outreach/`](../../../docs/swiss-outreach/).

## Scope

Discover registered Swiss companies from a job/project description, enrich public contacts, score fit, draft personalized quotation emails (de/fr/it/en), and manage human approval before send (unless `sendAutomatically` is set).

## Directory layout

```
swissOutreach/
├── api/swissOutreach/private/     # Express routes (auto-discovered)
│   ├── campaign.ts                # CRUD + start/cancel/approveAll/sendApproved + POST /logs
│   ├── prospectCompany.ts         # list/edit/delete (only the pipeline creates prospects)
│   ├── outreachEmail.ts           # list/edit/delete + approve/skip/editDraft/doNotContact (only the pipeline creates emails)
│   ├── suppressedContact.ts       # the company's do-not-contact list (create/list/delete)
│   └── dashboard.ts               # GET /summary
├── database/
│   ├── moduleBootstrap.ts
│   └── schemas/
│       ├── campaign/
│       ├── prospectCompany/
│       ├── outreachEmail/
│       ├── suppressedContact/     # Do-not-contact list, checked by every campaign
│       └── pipelineRunLog/        # Structured step logs (no CRUD router)
├── kafka/                         # swissOutreach.pipeline producer + consumer
├── utilities/
│   ├── ports/                     # Replaceable interfaces
│   ├── adapters/                  # ZEFIX, canton stub, LLM, search, crawl, mail, URL safety
│   ├── pipeline/                  # Orchestrator, job parse, email gen, concurrency, cancel
│   ├── scoring/                   # Prospect score 0–100 + dedupe key
│   ├── monitoring/                # In-process counters
│   ├── mappers/                   # Document → DTO / select
│   ├── cron/                      # retryStuckCampaigns handler
│   ├── erasure/                   # person eraser (D57)
│   └── config.ts                  # Env-backed limits and providers
└── _tests/                        # Unit + integration + e2e
```

## API routes

Routes are discovered from `api/swissOutreach/private/`. Mounted under `/api/swissOutreach/<file>`.

The campaign and email actions (`start`, `cancel`, `approveAll`, `sendApproved`, `approve`, `skip`, `editDraft`, `doNotContact`) are `@action` methods in `database/schemas/campaign/campaign.actions.ts` and `database/schemas/outreachEmail/outreachEmail.actions.ts`. Each is its own role permission (`swissoutreachcampaigns[action:<name>]`, `swissoutreachemails[action:<name>]`, D86); admin roles get them. Sent or sending emails cannot be skipped or edited (`email_already_sent`); a campaign sends only from `awaiting_approval`/`completed`/`failed` (`campaign_cannot_send`) and cannot start while running, sending, completed or cancelled (`campaign_cannot_start`) (D85).

| Route file | Base path | Notable endpoints |
|------------|-----------|-------------------|
| `campaign.ts` | `/api/swissOutreach/campaign` | Standard CRUD; `POST /start`, `/cancel`, `/approveAll`, `/sendApproved`; `POST /logs` (`{campaignId}`, needs read access to the campaign's `lastError`) |
| `prospectCompany.ts` | `/api/swissOutreach/prospectCompany` | List (filter `campaignId`, sorted by score), edit, delete; create is `no-permission` |
| `outreachEmail.ts` | `/api/swissOutreach/outreachEmail` | List (filter `campaignId`), edit of a draft/edited/skipped/failed email (`email_not_editable` otherwise), delete; `POST /approve`, `/skip`, `/editDraft`, `/doNotContact`; create is `no-permission` |
| `suppressedContact.ts` | `/api/swissOutreach/suppressedContact` | Create (an address, a domain or both, lower-cased), list, delete; entries are not edited |
| `dashboard.ts` | `/api/swissOutreach/dashboard` | `GET /summary` (the company's own counts only) |

`status`, `stats`, `parsedJob`, `lastError` (campaign), `status`/`campaignId`/`prospectCompanyId` (email) and `status`/`campaignId`/`dedupeKey` (prospect) are server-owned: no create or edit form writes them.

A campaign's `cantons` are canton codes (`swissCantonCodes` in armonia `types/constants.ts`, picked in a multi-select showing each canton's own name); any other value is refused by the form schema and by the Mongoose enum. None means the whole country.

Campaign create sets `status: draft`, seeds empty stats, then, once the create has committed, claims the run (`draft` → `parsing` in one write) and enqueues `CampaignOrchestrator`. `start` claims the same way from `draft`/`failed`/`awaiting_approval`, so two starts get one run; the stuck-campaign cron re-claims campaigns left 15 minutes in `draft` or a discovery stage. A run that finds its campaign sending, completed or cancelled (a redelivered Kafka event) does nothing.

## Do-not-contact and opt-out

Every drafted email ends with an opt-out sentence in its language (`OUTREACH_OPT_OUT_LINES` in armonia `prompts/outreachPrompts.ts`). A recipient who asks to stop goes on the company's do-not-contact list (`doNotContact` on the email, or the list page); drafting and sending skip listed addresses and domains for every campaign of the company. With `EMAIL_ENABLED` off, a send fails with `outreach_mail_disabled` instead of counting as sent.

## Pipeline

`CampaignOrchestrator` drives each campaign through:

1. **Job parse** — LLM + heuristic fallback (`JobParser`)
2. **Company search** — live ZEFIX REST (+ optional canton register stub merge)
3. **Website discovery** — Serper / Bing / Google CSE / none
4. **Crawl** — HTTP + robots.txt + delays (`HttpWebsiteFetcher`)
5. **AI summary** — ≤150 words from crawl evidence
6. **Scoring** — 0–100 (`scoreProspect`)
7. **Email generation** — subject/body in campaign language/tone
8. **Approval** — default human gate (`awaiting_approval`)
9. **Send** — `MailPort` via smtp / gmail / microsoft365 presets
10. **Persist** — campaign stats + `pipelineRunLog` entries

Status progression: `draft` → `parsing` → `searching` → `enriching` → `scoring` → `awaiting_approval` → `sending` → `completed` / `failed` / `cancelled`.

## Async execution

1. Campaign create (or `POST /start`) → `CampaignOrchestrator.enqueue`; `POST /sendApproved` claims the campaign (`sending`, one compare-and-set write, so a second send is refused with `campaign_cannot_send`) and answers at once, then `CampaignOrchestrator.enqueueSend` sends in the background
2. With `SWISS_OUTREACH_USE_KAFKA_PIPELINE=true`, both publish to the Kafka topic `swissOutreach.pipeline` (`KAFKA_TOPIC_SWISS_OUTREACH_PIPELINE`; actions `run` and `send_approved`)
3. Otherwise, or when the publish fails, they run in-process
4. Successful sends of a campaign are spaced to at most `SWISS_OUTREACH_MAX_SENDS_PER_MINUTE`; each send writes the campaign (`stats.sent`/`stats.failed`), so the detail page shows the progress. A send that breaks fails the campaign with its error
5. Cron `swissOutreach.retryStuckCampaigns`, for campaigns untouched for ~15 minutes: re-claims and re-enqueues discovery stages and drafts, puts stuck `queued` emails back to `approved`, and resumes a `sending` campaign (its sender died; each email is claimed atomically, so none is sent twice by the resumed send)

Cancel aborts the in-flight run and un-claims `queued` emails so they are not stranded.

## Replaceable ports

Wired in `utilities/adapters/createPorts.ts`:

| Port | Default adapters |
|------|------------------|
| `CompanyRegistryPort` | `ZefixRestClient` (live ZEFIX) + `CantonCommercialRegisterClient` (stub) composite |
| `WebSearchPort` | Serper / Bing / Google CSE / Noop |
| `WebsiteFetchPort` | `HttpWebsiteFetcher` |
| `LlmPort` | OpenAI-compatible / Ollama |
| `MailPort` | Documented adapter → core `mailDeliveryService` |

## Configuration

Every variable is optional (defaults in `utilities/config.ts`); `environment.validator.ts` checks a set value at boot (D67).

| Env | Default | Role |
|-----|---------|------|
| `SWISS_OUTREACH_ZEFIX_BASE_URL` | `https://www.zefix.ch/ZefixREST/api/v1` | Public SPA API; the authenticated ZefixPublicREST base when credentials are set |
| `SWISS_OUTREACH_ZEFIX_USERNAME` / `_PASSWORD` | — | Authenticated ZefixPublicREST; both or neither |
| `SWISS_OUTREACH_MAX_COMPANIES_DEFAULT` | 50 | Cap per campaign when the form gives none (1–500) |
| `SWISS_OUTREACH_SEARCH_DEPTH` | 3 | Keywords searched in ZEFIX; pages crawled per site = depth + 2 (1–10) |
| `SWISS_OUTREACH_CONCURRENCY` | 3 | Prospects enriched at once (1–20) |
| `SWISS_OUTREACH_REQUEST_DELAY_MS` | 750 | Pause before each crawl request; also the retry back-off unit (0–60000) |
| `SWISS_OUTREACH_REQUEST_TIMEOUT_MS` | 30000 | Per outbound call (1000–300000) |
| `SWISS_OUTREACH_RETRY_COUNT` | 3 | Tries per email send (1–10) |
| `SWISS_OUTREACH_MAX_SENDS_PER_MINUTE` | 10 | Successful sends of one campaign per minute, spaced evenly (1–600) |
| `SWISS_OUTREACH_USE_KAFKA_PIPELINE` | `false` | Runs and sends through the Kafka topic instead of in-process |
| `SWISS_OUTREACH_WEB_SEARCH_PROVIDER` | `none` | `serper` \| `bing` \| `google` \| `none`; the chosen provider's key is then required: `SWISS_OUTREACH_SERPER_API_KEY`, `SWISS_OUTREACH_BING_API_KEY`, or `SWISS_OUTREACH_GOOGLE_CSE_API_KEY` + `SWISS_OUTREACH_GOOGLE_CSE_CX` |
| `SWISS_OUTREACH_LLM_PROVIDER` | `ollama` | `ollama` \| `openai` (any OpenAI-compatible endpoint; no key required) |
| `SWISS_OUTREACH_LLM_BASE_URL` / `_MODEL` / `_API_KEY` | `AI_ASSISTANT_BASE_URL` / `AI_ASSISTANT_MODEL`, else `http://localhost:11434` / `llama3.1:8b` | LLM endpoint |
| `SWISS_OUTREACH_EMAIL_PROVIDER` | `smtp` | `smtp` \| `gmail` \| `microsoft365` (`m365`, `office365`): which SMTP profile operators configure; all deliver through core mail |

ZEFIX, each web search provider and the LLM sit behind their own core circuit breaker (`CircuitBreaker`, BE-09): after 5 failures in a minute calls fail fast for 30 s. A crawled site that fails to load twice is not asked for its remaining pages.

## Database schemas

Registered via `database/moduleBootstrap.ts`. Each resource folder follows the core pattern:

- `*.ts` — Mongoose model validated against armonia `*SchemaDef`
- `*.service.ts` — `BaseCrudService` subclass
- `*.indexes.ts`, `*.snippets.ts`, `*.views.ts` (where applicable)

`pipelineRunLog` is write-only from the orchestrator; exposed via `GET /campaign/:id/logs`.

## Tests

```bash
cd maestro
npx vitest run modules/swissOutreach
```

`outreach.scoring` (scoring, job parsing, drafts), `outreach.pipeline` (orchestrator, sending, cron) and `outreach.approval` (HTTP actions, permissions, tenancy, dashboard) use the fake ports in `outreach.fixtures.ts`; no live provider is called. `outreach.resilience` covers the send throttle, the background send, the circuit breakers, the environment validator and the canton codes.

## Path alias

```ts
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
```

Configured in `maestro/tsconfig.json` as `@swissOutreachModule/*` → `./modules/swissOutreach/*`.

## Related packages

| Package | Location |
|---------|----------|
| Armonia contracts | [`armonia/src/modules/swissOutreach`](../../../armonia/src/modules/swissOutreach/README.md) |
| Panel UI | [`sinfonia/src/modules/swissOutreach`](../../../sinfonia/src/modules/swissOutreach/README.md) |
| Architecture | [`docs/swiss-outreach/ARCHITECTURE.md`](../../../docs/swiss-outreach/ARCHITECTURE.md) |
