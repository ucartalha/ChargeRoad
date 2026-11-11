# ChargeRoad

ChargeRoad is a mobile-first route and charging planner for electric vehicles. It will use vehicle characteristics, weather, and charging-station data to estimate energy use, choose charging stops, and update the remaining trip during navigation.

## Product constraints

- Route and charging decisions must run without an LLM dependency, using our own energy and optimization algorithms. Versioned shared contracts now describe these inputs/outputs; calculation algorithms remain unimplemented.
- Road/map providers may supply geometry, travel times, and road attributes. Their ready-made EV stop selection must not replace our planning engine.
- Users provide the starting battery percentage and can update it after charging or during a trip. The latest user input becomes the new battery baseline for planning the remaining journey.
- Estimated battery levels and station availability must show their uncertainty and data freshness.

## Planning documents

The product scope and implementation backlog are documented in Turkish:

- [Documentation index](docs/README.md)
- [Product scope and user flows](docs/PRODUCT_SCOPE.md)
- [Routing and energy rules](docs/ROUTING_ENGINE.md)
- [Validated planning contracts](docs/DOMAIN_CONTRACTS.md)
- [Shared API rate limiting](docs/RATE_LIMITING.md)
- [Implementation tasks and acceptance criteria](docs/TASKS.md)
- [Open architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- [Architecture decision record template](docs/adr/000-template.md)

The first vehicle catalogue uses PostgreSQL, versioned SQL migrations, and a manual OpenEV Data import. Read the [catalogue guide](docs/VEHICLE_CATALOGUE.md) for commands, API endpoints, and source limitations. Redis, authentication, authorization, sessions, other data providers, and map/routing choices remain open.

## Existing foundation

- **Mobile:** Expo + React Native + TypeScript.
- **API:** NestJS + TypeScript.
- **Local database definition:** PostgreSQL with PostGIS in Docker Compose.
- **Workspace:** pnpm + Turbo with shared TypeScript contracts.

The vehicle catalogue has a database schema, validated versioned imports, provenance, and DB-only read endpoints. Other product domains and the EV planning engine are not implemented.

## Repository layout

```text
apps/
  api/       NestJS HTTP API
  mobile/    Expo React Native app
packages/
  shared/    Cross-app TypeScript contracts
docs/        Product requirements, tasks, and architecture decisions
```

## Local setup

Prerequisites: Node.js 20.19 or newer, pnpm 9, and Docker Desktop.

1. Copy `.env.example` to `.env`. Set a random shared `RATE_LIMIT_IP_HASH_SECRET` of at least 32 characters before starting the HTTP API. Provider keys are placeholders until integrations are selected and implemented. Never commit real keys.
2. Install dependencies with `pnpm install`.
3. Start the development database with `pnpm db:up`.
4. Apply catalogue migrations with `pnpm db:migrate`.
5. Import the pinned vehicle dataset with `pnpm vehicles:import`.
6. Start the API and mobile app with `pnpm dev`.

The NestJS health endpoint is `http://localhost:3000/v1/health`. The mobile catalogue can be opened through Expo Go or a simulator. Choose a make, model, and year/variant under the Vehicles tab; the confirmed vehicle is stored locally by ID and shown on the route screen. Native map/navigation integrations may require development builds once selected.

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` when the app is connected to the API. For a physical phone, use the computer's LAN IP instead of `localhost`.

## Current status

The first catalogue import populated 65 makes, 260 models, and 1,189 vehicle records from OpenEV Data v1.24.0. Repeating the import preserves IDs and does not create duplicate vehicles. Vehicle APIs read only from the database; they never download upstream data during requests.

This source release has no direct consumption values or DC charge curves, and no explicit TR market entries. Missing values remain null or absent child records. Catalogue availability does not imply energy-planning readiness or verified Turkish-market coverage. The [source licence text](third_party/open-ev-data.LICENSE.md) is retained in the repository.

The Valhalla/OSM road adapter and MET Norway weather provider are implemented with shared PostgreSQL caching and quota coordination. See [road delivery](docs/ROAD_PROVIDERS.md) and [weather delivery](docs/WEATHER_PROVIDERS.md). EV energy/SOC calculation, stop optimization, trip battery corrections, user accounts, map/navigation UI and weekly import scheduling remain separate work.

CR-007 update: the static station catalogue and indexed PostGIS corridor provider are implemented;
17,165 EPDK locations and 50,259 connector claims are stored. Live availability, physical EVSE
group enrichment and actual road access/detours remain separate work. See [station delivery](docs/STATION_CATALOGUE.md).

Supplemental vehicle evidence uses a source-independent catalogue and versioned knowledge packages.
See [Task 6 delivery and data gaps](docs/VEHICLE_KNOWLEDGE.md).
Additional source attribution: [Open EV Data](https://github.com/KilowattApp/open-ev-data),
MIT License with Attribution Requirement; [retained licence](third_party/kilowatt-open-ev-data.LICENSE.md).
