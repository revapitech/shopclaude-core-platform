# QA / Staging Environment — Setup Guide

## Root Cause

| Session | API URL | Backend | Database |
|---|---|---|---|
| Local Admin `localhost:5174/?tenant=ismart` | `.env.local` → `localhost:8082` | Spring Boot :8082 | `localhost:5434/gosuas_core_db` (dev) |
| Production Storefront `ismart.theshopclaude.com` | `.env.production` → Nginx :8081 | Spring Boot :8081 | `localhost:5432/gosuas_core_db` (prod) |

Products created on `localhost:5174/?tenant=ismart` write to the **local dev database**.
The production storefront reads from the **production database**.
They are independent — changes in one never reach the other.

**To manage production products:** visit `ismart.theshopclaude.com` (without `/shops`),
log in, and create/update products there.

---

## QA Environment Overview

The QA environment is a local full-stack where **both Admin and Storefront hit the same
backend and database**, so a product created in Admin appears on the Storefront instantly —
identical to what production does.

| Component | Location | Config |
|---|---|---|
| QA Backend | `localhost:8083` | `application-qa.yml` |
| QA Database | `localhost:5434/gosuas_qa_db` | separate from `gosuas_core_db` |
| QA Admin | `localhost:5174/?tenant=qa-ismart` | `.env.qa` |
| QA Storefront | `localhost:5174/shops` | `.env.qa` |

---

## Setup (run once)

### 1. Create the QA database

```bash
psql -U postgres -h localhost -p 5434 -c "CREATE DATABASE gosuas_qa_db;"
```

### 2. Start the QA backend

```bash
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=qa
# Starts on port 8083.
# Hibernate creates the schema on first run (ddl-auto: update).
# Seed gosuas tenant and QA super-admin are created automatically.
```

### 3. Start the QA frontend

```bash
cd frontend
npm run dev:qa
# Dev server on localhost:5174
# VITE_API_URL=http://localhost:8083/gosuas-core/api  (from .env.qa)
```

---

## Accessing the QA environment

**Admin Dashboard:**
```
http://localhost:5174/?tenant=qa-ismart
```
Sign up with subdomain `qa-ismart`, plan FREE (no payment required).
All product writes go to `gosuas_qa_db`.

**Public Storefront:**
```
http://localhost:5174/shops
```
After visiting the Admin URL, `sc_dev_tenant=qa-ismart` is stored in localStorage.
The storefront calls `GET /api/public/products?subdomain=qa-ismart` on the QA backend —
the same database the Admin just wrote to.

> Both URLs share `VITE_API_URL=http://localhost:8083/gosuas-core/api` from `.env.qa`.
> Admin writes and Storefront reads always hit the same QA database.

---

## Environment comparison

| Setting | Local Dev | QA | Production |
|---|---|---|---|
| npm script | `dev` | `dev:qa` | `build` |
| API URL | `localhost:8082` | `localhost:8083` | `/gosuas-core/api` (Nginx) |
| Spring profile | `local` | `qa` | `prod` |
| Database | `gosuas_core_db` :5434 | `gosuas_qa_db` :5434 | `gosuas_core_db` :5432 |
| Upload dir | `./uploads` | `./uploads-qa` | `/var/www/gosuas/uploads` |
| JWT secret | local | qa (distinct) | prod |
| Razorpay | TEST | TEST | LIVE/TEST per tenant |

---

## Acceptance Tests

Run these curl commands while the QA backend is running at `localhost:8083`.

```bash
QA=http://localhost:8083/gosuas-core/api
```

### Setup — register two QA tenants

```bash
# Tenant A — qa-ismart
curl -s -X POST $QA/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"shopName\":\"QA iSmart\",\"subdomain\":\"qa-ismart\",\"ownerName\":\"QA Owner\",\"ownerEmail\":\"qa@ismart.test\",\"phoneNumber\":\"9000000001\",\"password\":\"QaIsmart@123\",\"plan\":\"FREE\"}"

# Tenant B — qa-shopb (for tenant isolation test)
curl -s -X POST $QA/auth/signup \
  -H "Content-Type: application/json" \
  -d "{\"shopName\":\"QA Shop B\",\"subdomain\":\"qa-shopb\",\"ownerName\":\"QA Owner B\",\"ownerEmail\":\"qa@shopb.test\",\"phoneNumber\":\"9000000002\",\"password\":\"QaShopB@123\",\"plan\":\"FREE\"}"
```

Re-running signup returns `"already taken"` — that is expected and harmless. Log in instead:

```bash
TOKEN_A=$(curl -s -X POST $QA/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"qa@ismart.test\",\"password\":\"QaIsmart@123\",\"subdomain\":\"qa-ismart\"}" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

TOKEN_B=$(curl -s -X POST $QA/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"qa@shopb.test\",\"password\":\"QaShopB@123\",\"subdomain\":\"qa-shopb\"}" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
```

---

### T1 — Create product with Show on Website = true

```bash
curl -s -X POST $QA/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_A" \
  -d "{\"name\":\"QA Headphones\",\"category\":\"Electronics\",\"sku\":\"QA-HP-001\",\"barcode\":\"QA1234567890\",\"purchasePrice\":3000,\"sellingPrice\":8999,\"mrp\":9999,\"stockQty\":25,\"active\":true,\"productType\":\"OTHER\",\"trackStock\":true}"
# PASS: response contains id, name="QA Headphones", active=true

PRODUCT_ID=<paste id from above response>
```

---

### T2 — Verify product in Admin Inventory

```bash
curl -s $QA/products -H "Authorization: Bearer $TOKEN_A" | grep "$PRODUCT_ID"
# PASS: match found
```

---

### T3 — Verify product in Public Storefront

```bash
curl -s "$QA/public/products?subdomain=qa-ismart" | grep "$PRODUCT_ID"
# PASS: match found (active=true so it is publicly visible)
```

---

### T4 — Update product name and description

```bash
curl -s -X PUT $QA/products/$PRODUCT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_A" \
  -d "{\"name\":\"QA Headphones v2\",\"category\":\"Electronics\",\"sku\":\"QA-HP-001\",\"barcode\":\"QA1234567890\",\"purchasePrice\":3000,\"sellingPrice\":8999,\"mrp\":9999,\"stockQty\":25,\"active\":true,\"productType\":\"OTHER\",\"trackStock\":true}"
# PASS: response contains "name":"QA Headphones v2"
```

---

### T5 — Disable Show on Website (active=false)

```bash
curl -s -X PUT $QA/products/$PRODUCT_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_A" \
  -d "{\"name\":\"QA Headphones v2\",\"category\":\"Electronics\",\"sku\":\"QA-HP-001\",\"barcode\":\"QA1234567890\",\"purchasePrice\":3000,\"sellingPrice\":8999,\"mrp\":9999,\"stockQty\":25,\"active\":false,\"productType\":\"OTHER\",\"trackStock\":true}"
# PASS: response contains "active":false
```

---

### T6 — Verify hidden from Public Storefront, still visible in Admin

```bash
# Should NOT appear on storefront
curl -s "$QA/public/products?subdomain=qa-ismart" | grep "$PRODUCT_ID"
# PASS: NO match (product is hidden)

# Should still appear in Admin Inventory
curl -s $QA/products -H "Authorization: Bearer $TOKEN_A" | grep "$PRODUCT_ID"
# PASS: match found (admin always sees all products regardless of active flag)
```

---

### T7 — Tenant isolation

```bash
# Create a product for Tenant B
PROD_B=$(curl -s -X POST $QA/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_B" \
  -d "{\"name\":\"Shop B Exclusive\",\"category\":\"Test\",\"sku\":\"QB-001\",\"barcode\":\"QB0000000001\",\"sellingPrice\":500,\"mrp\":600,\"stockQty\":10,\"active\":true,\"productType\":\"OTHER\"}" \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

# Shop A storefront must NOT contain Shop B product
curl -s "$QA/public/products?subdomain=qa-ismart" | grep "$PROD_B"
# PASS: NO match

# Shop B storefront must NOT contain Shop A product
curl -s "$QA/public/products?subdomain=qa-shopb" | grep "$PRODUCT_ID"
# PASS: NO match
```

---

## .gitignore additions

```
frontend/.env.qa
uploads-qa/
```

---

## Why not connect local dev to the production database?

- Test products and tenants pollute production data visible to real customers
- JWT secrets differ between profiles — local tokens are not valid on production
- File uploads create orphaned files on the production server
- The QA setup is a safe, isolated, production-equivalent stack on your machine
