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
│   ├── campaign.ts                # CRUD + start/cancel/approveAll/sendApproved + nested GETs
│   ├── prospectCompany.ts         # CRUD
│   ├── outreachEmail.ts           # CRUD + approve/skip/editDraft
│   └── dashboard.ts               # GET /summary
├── database/
│   ├── moduleBootstrap.ts
│   └── schemas/
│       ├── campaign/
│       ├── prospectCompany/
│       ├── outreachEmail/
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
│   └── config.ts                  # Env-backed limits and providers
└── __tests__/                     # Unit + integration + e2e
```

## API routes

Routes are discovered from `api/swissOutreach/private/`. Mounted under `/api/swissOutreach/<file>`.

| Route file | Base path | Notable endpoints |
|------------|-----------|-------------------|
| `campaign.ts` | `/api/swissOutreach/campaign` | Standard CRUD; `POST /start`, `/cancel`, `/approveAll`, `/sendApproved`; `GET /:campaignId/prospects`, `/emails`, `/logs` |
| `prospectCompany.ts` | `/api/swissOutreach/prospectCompany` | CRUD (sorted by score) |
| `outreachEmail.ts` | `/api/swissOutreach/outreachEmail` | CRUD; `POST /approve`, `/skip`, `/editDraft` |
| `dashboard.ts` | `/api/swissOutreach/dashboard` | `GET /summary` |

Campaign create sets `status: draft`, seeds empty stats, then `afterCreate` enqueues `CampaignOrchestrator`.

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

1. Campaign create (or `POST /start`) → `CampaignOrchestrator.enqueue`
2. Publishes Kafka topic `swissOutreach.pipeline` when available (`KAFKA_TOPIC_SWISS_OUTREACH_PIPELINE`)
3. Otherwise runs in-process
4. Cron `swissOutreach.retryStuckCampaigns` re-enqueues mid-flight discovery stages (not active sends) after ~15 minutes; reclaims stuck `queued` emails back to `approved`

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

## Configuration (high level)

| Env | Role |
|-----|------|
| `SWISS_OUTREACH_ZEFIX_BASE_URL` | Default `https://www.zefix.ch/ZefixREST/api/v1` (public SPA API) |
| `SWISS_OUTREACH_ZEFIX_USERNAME` / `PASSWORD` | Optional; only for authenticated ZefixPublicREST |
| `SWISS_OUTREACH_MAX_COMPANIES_DEFAULT` | Default cap per campaign |
| `SWISS_OUTREACH_CONCURRENCY` / `REQUEST_DELAY_MS` / `RETRY_COUNT` | Throughput and politeness |
| `SWISS_OUTREACH_ZEFIX_*` | ZEFIX REST credentials |
| `SWISS_OUTREACH_WEB_SEARCH_PROVIDER` | `serper` \| `bing` \| `google` \| `none` |
| `SWISS_OUTREACH_LLM_*` | Provider, base URL, model |
| `SWISS_OUTREACH_EMAIL_PROVIDER` | `smtp` \| `gmail` \| `microsoft365` |

Full list: `utilities/config.ts` and [`docs/swiss-outreach/env.example`](../../../docs/swiss-outreach/env.example).

## Database schemas

Registered via `database/moduleBootstrap.ts`. Each resource folder follows the core pattern:

- `*.ts` — Mongoose model validated against armonia `*SchemaDef`
- `*.service.ts` — `BaseCrudService` subclass
- `*.indexes.ts`, `*.snippets.ts`, `*.views.ts` (where applicable)

`pipelineRunLog` is write-only from the orchestrator; exposed via `GET /campaign/:id/logs`.

## Tests

```bash
cd maestro
npm test -- modules/swissOutreach/__tests__/scoring.extractor.test.ts
npm test -- modules/swissOutreach/__tests__/orchestrator.integration.test.ts
npm test -- modules/swissOutreach/__tests__/e2e.pipeline.test.ts
```

Also covered: URL safety, ZEFIX fixtures, cancel/send, reliability helpers.

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
