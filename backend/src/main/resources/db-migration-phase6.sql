-- ============================================================
-- Phase 6 Migration: Performance indexes + data integrity checks
-- ============================================================
-- Run ONCE on each environment (prod, qa, local) AFTER deploying
-- the Phase 2–5 JAR and running db-migration-phase2.sql.
--
-- All statements are idempotent: CREATE INDEX IF NOT EXISTS is
-- safe to run multiple times without side effects.
--
-- Run order:
--   1. Deploy the new backend JAR (Hibernate creates composite constraints)
--   2. Run db-migration-phase2.sql  (drops old global unique constraints)
--   3. Run db-migration-phase6.sql  (adds performance indexes + verifies data)
-- ============================================================

-- ── Section 1: Performance indexes on tenant_id ───────────────────────────
-- These tables are queried by tenant_id on every request but have no
-- dedicated index on that column. The composite unique constraints (e.g.
-- uq_damage_no_tenant) have the serial number as the leading column, so
-- they don't serve range/list queries filtering only on tenant_id.

CREATE INDEX IF NOT EXISTS idx_bill_tenant_id
    ON public.bill (tenant_id);

CREATE INDEX IF NOT EXISTS idx_customer_detail_tenant_id
    ON public.customer_detail (tenant_id);

CREATE INDEX IF NOT EXISTS idx_damage_stock_tenant_id
    ON public.damage_stock (tenant_id);

CREATE INDEX IF NOT EXISTS idx_sales_return_tenant_id
    ON public.sales_return (tenant_id);

CREATE INDEX IF NOT EXISTS idx_rental_order_tenant_id
    ON public.rental_order (tenant_id);

CREATE INDEX IF NOT EXISTS idx_shop_order_tenant_id
    ON public.shop_order (tenant_id);

-- product(tenant_id) already created by Hibernate via @Index annotation.
-- expense(tenant_id) already created by Hibernate via @Index annotation.

-- ── Section 2: Data integrity verification ───────────────────────────────
-- Run these SELECT queries manually to verify no data integrity issues
-- before onboarding additional tenants. Each should return 0 rows.
-- (These are commented out — copy-paste into psql to run.)

-- Check for products with no tenant assignment:
-- SELECT COUNT(*) FROM public.product WHERE tenant_id IS NULL;

-- Check for bills with no tenant assignment:
-- SELECT COUNT(*) FROM public.bill WHERE tenant_id IS NULL;

-- Check for shop_orders with no tenant assignment:
-- SELECT COUNT(*) FROM public.shop_order WHERE tenant_id IS NULL;

-- Check for customer_detail with no tenant assignment:
-- SELECT COUNT(*) FROM public.customer_detail WHERE tenant_id IS NULL;

-- Check for damage_stock with no tenant assignment:
-- SELECT COUNT(*) FROM public.damage_stock WHERE tenant_id IS NULL;

-- Check for sales_return with no tenant assignment:
-- SELECT COUNT(*) FROM public.sales_return WHERE tenant_id IS NULL;

-- Check for rental_order with no tenant assignment:
-- SELECT COUNT(*) FROM public.rental_order WHERE tenant_id IS NULL;

-- ── Section 3: Confirm new composite constraints exist ───────────────────
-- Run these to confirm Hibernate created the composite constraints on
-- startup before you ran db-migration-phase2.sql to drop the old ones.
-- Each should return 1 row.
-- (These are commented out — copy-paste into psql to run.)

-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_schema = 'public' AND constraint_name = 'uq_product_sku_tenant';

-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_schema = 'public' AND constraint_name = 'uq_product_barcode_tenant';

-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_schema = 'public' AND constraint_name = 'uq_bill_no_tenant';

-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_schema = 'public' AND constraint_name = 'uq_damage_no_tenant';

-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_schema = 'public' AND constraint_name = 'uq_return_no_tenant';

-- SELECT constraint_name FROM information_schema.table_constraints
-- WHERE table_schema = 'public' AND constraint_name = 'uq_rental_no_tenant';

-- ── Section 4: Confirm GOSUAS tenant data is intact ───────────────────────
-- Run after migration to verify the GOSUAS tenant's historical data is
-- accessible and correctly attributed.
-- (These are commented out — copy-paste into psql to run.)

-- SELECT t.subdomain, t.name, t.plan, t.status,
--        (SELECT COUNT(*) FROM public.product  p WHERE p.tenant_id = t.id) AS products,
--        (SELECT COUNT(*) FROM public.bill      b WHERE b.tenant_id = t.id) AS bills
-- FROM public.tenant t
-- WHERE t.subdomain = 'gosuas';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- To undo the performance indexes (safe to drop — no data loss, indexes
-- are rebuilt automatically if you re-run this script):
--
-- DROP INDEX IF EXISTS public.idx_bill_tenant_id;
-- DROP INDEX IF EXISTS public.idx_customer_detail_tenant_id;
-- DROP INDEX IF EXISTS public.idx_damage_stock_tenant_id;
-- DROP INDEX IF EXISTS public.idx_sales_return_tenant_id;
-- DROP INDEX IF EXISTS public.idx_rental_order_tenant_id;
-- DROP INDEX IF EXISTS public.idx_shop_order_tenant_id;
-- ============================================================