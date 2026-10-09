# GOSUAS Core Platform MVP

Modules included:
- Product inventory
- Barcode generation
- Barcode-based POS billing
- Stock deduction after billing
- Basic React admin/POS screen

## Backend setup

Create PostgreSQL DB:

```sql
CREATE DATABASE gosuas_core_db;
```

Run backend:

```bash
cd backend
mvn spring-boot:run
```

Backend URL:

```text
http://localhost:8080/gosuas-core
```

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## API examples

Create product:

```bash
curl -X POST http://localhost:8080/gosuas-core/api/products \
-H 'Content-Type: application/json' \
-d '{"name":"Gold Plated Necklace","category":"Necklace","sku":"GOS-NCK-001","purchasePrice":250,"sellingPrice":599,"mrp":999,"stockQty":10}'
```

Generate bill:

```bash
curl -X POST http://localhost:8080/gosuas-core/api/bills \
-H 'Content-Type: application/json' \
-d '{"customerName":"Walk-in Customer","paymentMode":"UPI","discountAmount":0,"items":[{"barcode":"PASTE_BARCODE_HERE","quantity":1}]}'
```
