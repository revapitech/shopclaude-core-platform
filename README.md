# shopclaude-core-platform

Multi-tenant shop management platform — Spring Boot 3 backend + React (Vite) frontend.

---

## Local Development Setup

### Prerequisites

- Java 17+
- Maven 3.9+
- Node.js 18+
- PostgreSQL (default port `5434` locally)

### Backend

1. **Create your local config** — `application.yml` is gitignored. Copy the example and fill in your values:

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

   All fields support `${ENV_VAR:fallback}` — the fallback is used automatically if the env var is not set, so for local dev the defaults work out of the box.

2. **Run with the `local` profile:**

   ```bash
   cd backend
   mvn spring-boot:run -Dspring-boot.run.profiles=local
   ```

   The API will be available at `http://localhost:8080/gosuas-core/api`.

3. **Run tests:**

   ```bash
   cd backend
   mvn test
   ```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.

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
