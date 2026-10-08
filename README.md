# CodeTrack

A React and Express application for tracking DSA practice from LeetCode and Codeforces. PostgreSQL is accessed through Prisma.

## What it does

- Authenticates learners with password hashing and JWT sessions.
- Imports LeetCode and Codeforces activity and turns it into dashboard analytics.
- Shows problem totals, topic coverage, difficulty/rating distributions, trends, heatmaps, streaks, and recent activity.
- Generates personalized, explainable Codeforces and LeetCode recommendations.
- Provides a protected operations console for authorized administrators.

## Technology flow

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Client | React 19, Vite, React Router, Recharts | Dashboard, onboarding, analytics, recommendation UI |
| API | Node.js, Express 5, JWT, bcrypt, Axios | Authentication, validation, imports, analytics, recommendation endpoints |
| Data | PostgreSQL and Prisma ORM | Users, handles, problems, submissions, recommendations, feedback |
| External services | LeetCode GraphQL, Codeforces REST, Manifest V3 extension | Submission and problem-metadata ingestion |
| Quality | Jest, Supertest, ESLint | Backend checks, API tests, and static analysis |

## Architecture map

```text
React + Vite browser app
        │  JSON requests + Bearer JWT
        ▼
Express API
  ├─ Auth and ownership middleware
  ├─ Platform import services ──── LeetCode GraphQL / Codeforces REST
  ├─ Dashboard analytics service
  ├─ Recommendation service
  │    ├─ learner-profile builder
  │    ├─ candidate selector
  │    ├─ Codeforces rule-based ranker
  │    └─ LeetCode difficulty-fit ranker
  └─ Operations/admin API
        │
        ▼
PostgreSQL (through Prisma)
  users · handles · problems · submissions · metadata · recommendations · feedback
```

## Request flow

```text
1. Sign in → frontend receives and sends the JWT.
2. Connect platform handles and import activity.
3. Backend fetches platform data, normalizes it, and transactionally stores
   problems and submissions.
4. Dashboard requests analytics and renders progress visualizations.
5. Recommendation panel calls GET /api/recommendations.
6. Backend builds the learner profile, filters unsolved candidates, ranks them,
   persists score/reason data, and returns the active recommendations.
7. Starting or dismissing a card posts feedback to the recommendation-events API.
```

### Recommendation logic

- **Codeforces:** ranks candidates using solved/attempted status, topic weakness with Bayesian smoothing, rating fit, freshness, tag novelty, and known-topic coverage.
- **LeetCode:** estimates a learner level from completed Easy/Medium/Hard problems, adds a small next-challenge offset, then weighs difficulty fit, topic weakness, and freshness.
- The cards explain their selection with reason labels such as “Right next challenge” and “Strengthen this topic.” Scores, score components, model versions, and feedback outcomes are retained in PostgreSQL.

## Local setup

Use a Node.js version supported by the installed Vite release (Node 22.12+ is a suitable baseline).

Backend:

```powershell
cd BackendAPI
npm ci
Copy-Item .env.example .env
# Configure DATABASE_URL, DIRECT_URL, JWT_SECRET and CORS_ORIGINS in .env.
npm run db:generate
npm run db:migrate
npm start
```

Frontend, in another terminal:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Do not overwrite an existing `.env` when following these instructions in an already configured checkout. The frontend API URL must include `/api`.

## How to use the app

1. Open the frontend URL printed by Vite (normally `http://localhost:5173`) and create an account or log in.
2. Complete onboarding with your LeetCode and Codeforces handles.
3. Import activity from the dashboard.
4. Explore the dashboard to review practice volume, topics, streaks, and recent submissions.
5. In **Recommendations**, choose a platform and select 1, 3, 5, or 10 suggestions.
6. Choose **Start problem** to open a recommendation or **Not now** to dismiss it. Import more activity over time for a more representative learner profile.

## Recommendation API

Authenticated requests use `Authorization: Bearer <token>`.

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/api/recommendations?platform=Codeforces&limit=3` | Retrieves existing or generates new recommendations. `platform` is `Codeforces` or `Leetcode`; `limit` is 1–10. |
| `POST` | `/api/recommendations/:recommendationId/events` | Records `shown`, `opened`, `started`, `dismissed`, `accepted`, or `attempted_not_solved`. |

## Checks

```powershell
npm test --prefix BackendAPI
npm run lint --prefix BackendAPI
npm run lint --prefix frontend
npm run build --prefix frontend
```

From `BackendAPI`, `npm run db:check` checks connectivity without modifying data. `npm run db:verify-import` creates synthetic records in a transaction that always rolls back; PostgreSQL sequence counters may still advance.

## Structure

- `BackendAPI/auth`, `controllers`, `middleware`, `routes`: authentication and HTTP API.
- `BackendAPI/services`: platform adapters and dashboard calculations.
- `BackendAPI/database`: shared Prisma client and platform import persistence.
- `BackendAPI/prisma`: schema and ordered migrations.
- `BackendAPI/scripts`, `tests`: diagnostics and regression coverage.
- `frontend/src/pages`: home, login, registration, onboarding and dashboard.
- `frontend/src/components`, `utils`: shared presentation and API requests.

## Current behavior and limitations

- LeetCode imports up to 20 recent accepted submissions; its current importer does not provide failed-attempt history.
- LeetCode problem metadata is cached by platform and slug. Events are imported independently of metadata cache hits.
- Native platform submission IDs preserve repeated attempts and prevent repeated imports from duplicating events.
- Problem counts describe unique attempted problems. Monthly/daily charts count submission events.
- Both platform handles are currently required by onboarding.
- Enrichment/description prototypes remain outside the supported runtime.

See [the migration and publication notes](MIGRATION_AND_PUBLICATION.md) for compatibility, deployment configuration and remaining limitations. Older architecture reports describe earlier snapshots and should be read alongside these notes.
## Operations console

The backend root and `/admin/logs` serve the private operations interface. Configure `ADMIN_USER_IDS` and the backend's `ADMIN_ORIGIN` before signing in. See [the setup and code walkthrough](OPERATIONS_DASHBOARD_GUIDE.md) for the complete learning guide and history-retention limits.
