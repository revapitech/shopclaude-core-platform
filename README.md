# shopclaude-core-platform

Multi-tenant shop management platform — Spring Boot 3 backend + React (Vite) frontend.

---

## Local Development Setup

### Prerequisites

- Java 17+
- Maven 3.9+
- Node.js 18+
- PostgreSQL running on port `5434`

### 1. Create local backend config

`application.yml` is gitignored. Copy the example and fill in your values:

```bash
cp backend/src/main/resources/application.yml.example backend/src/main/resources/application-local.yml
```

Minimum values to set in `application-local.yml`:

| Property | Description |
|----------|-------------|
| `spring.datasource.url` | PostgreSQL JDBC URL (default: `localhost:5434`) |
| `spring.datasource.username` / `password` | DB credentials |
| `jwt.secret` | At least 32-character signing key |
| `upload.dir` | Directory for uploaded images (default: `./uploads`) |

All fields support `${ENV_VAR:fallback}` — the fallback is used automatically if the env var is not set, so the defaults work out of the box for local dev.

### 2. Start the backend

```bash
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

Wait for this line before using the frontend:

```
Started GosuasCoreApplication in X seconds
```

The API is then available at `http://localhost:8080/gosuas-core/api`.

> **The backend must be running before the frontend is used.** Image uploads and all API calls fail with `net::ERR_CONNECTION_REFUSED` if it is not started.

### 3. Start the frontend

```bash
cd frontend
npm install   # first time only
npm run dev
```

The dev server starts at `http://localhost:5173`.

### 4. Run backend tests

```bash
cd backend
mvn test
```

---

## Configuration Files

| File | Purpose | Tracked |
|------|---------|---------|
| `application.yml.example` | Template — copy to create your local config | Yes |
| `application-local.yml` | Local dev config (DB creds, JWT secret) | Gitignored |
| `application-prod.yml` | Production config (uses env vars) | Yes |

---

## API Docs

Swagger UI is available at `http://localhost:8080/gosuas-core/swagger-ui.html` when the backend is running.
