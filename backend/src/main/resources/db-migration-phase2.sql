-- ============================================================
-- Phase 2 Migration: Drop old global unique constraints
-- Replace with tenant-scoped composite unique constraints
-- ============================================================
-- Run ONCE on each environment (prod, qa, local) AFTER deploying
-- the new backend JAR (which adds the new composite constraints).
--
-- Hibernate ddl-auto=update ADDS new constraints but never drops
-- old ones. The old global unique constraints must be dropped
-- manually or they will block multi-tenant data insertion.
--
-- Each block is idempotent — safe to run multiple times.
-- ============================================================

-- 1. product(sku) — drop old global unique; keep uq_product_sku_tenant
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name        = 'product'
      AND tc.table_schema      = 'public'
      AND tc.constraint_type   = 'UNIQUE'
      AND kcu.column_name      = 'sku'
      AND tc.constraint_name  != 'uq_product_sku_tenant'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE product DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on product(sku)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on product(sku) — skipping';
    END IF;
END $$;

-- 2. product(barcode) — drop old global unique; keep uq_product_barcode_tenant
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name        = 'product'
      AND tc.table_schema      = 'public'
      AND tc.constraint_type   = 'UNIQUE'
      AND kcu.column_name      = 'barcode'
      AND tc.constraint_name  != 'uq_product_barcode_tenant'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE product DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on product(barcode)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on product(barcode) — skipping';
    END IF;
END $$;

-- 3. customer_detail(email) — drop old global unique (no replacement needed; email is optional/sparse)
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name      = 'customer_detail'
      AND tc.table_schema    = 'public'
      AND tc.constraint_type = 'UNIQUE'
      AND kcu.column_name    = 'email'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE customer_detail DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on customer_detail(email)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on customer_detail(email) — skipping';
    END IF;
END $$;

-- 4. bill(bill_no) — drop old global unique; keep uq_bill_no_tenant
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name        = 'bill'
      AND tc.table_schema      = 'public'
      AND tc.constraint_type   = 'UNIQUE'
      AND kcu.column_name      = 'bill_no'
      AND tc.constraint_name  != 'uq_bill_no_tenant'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE bill DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on bill(bill_no)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on bill(bill_no) — skipping';
    END IF;
END $$;

-- 5. damage_stock(damage_no) — drop old global unique; keep uq_damage_no_tenant
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name        = 'damage_stock'
      AND tc.table_schema      = 'public'
      AND tc.constraint_type   = 'UNIQUE'
      AND kcu.column_name      = 'damage_no'
      AND tc.constraint_name  != 'uq_damage_no_tenant'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE damage_stock DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on damage_stock(damage_no)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on damage_stock(damage_no) — skipping';
    END IF;
END $$;

-- 6. sales_return(return_no) — drop old global unique; keep uq_return_no_tenant
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name        = 'sales_return'
      AND tc.table_schema      = 'public'
      AND tc.constraint_type   = 'UNIQUE'
      AND kcu.column_name      = 'return_no'
      AND tc.constraint_name  != 'uq_return_no_tenant'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE sales_return DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on sales_return(return_no)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on sales_return(return_no) — skipping';
    END IF;
END $$;

-- 7. rental_order(rental_no) — drop old global unique; keep uq_rental_no_tenant
DO $$
DECLARE con TEXT;
BEGIN
    SELECT tc.constraint_name INTO con
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    WHERE tc.table_name        = 'rental_order'
      AND tc.table_schema      = 'public'
      AND tc.constraint_type   = 'UNIQUE'
      AND kcu.column_name      = 'rental_no'
      AND tc.constraint_name  != 'uq_rental_no_tenant'
    LIMIT 1;

    IF con IS NOT NULL THEN
        EXECUTE 'ALTER TABLE rental_order DROP CONSTRAINT ' || quote_ident(con);
        RAISE NOTICE 'Dropped old constraint % on rental_order(rental_no)', con;
    ELSE
        RAISE NOTICE 'No old global unique constraint found on rental_order(rental_no) — skipping';
    END IF;
END $$;

-- ============================================================
-- ROLLBACK (if needed — run before reverting the JAR)
-- ============================================================
-- These recreate the old global constraints. Only run if you
-- are rolling back to the pre-Phase-2 JAR.
--
-- ALTER TABLE product         ADD CONSTRAINT product_sku_key     UNIQUE (sku);
-- ALTER TABLE product         ADD CONSTRAINT product_barcode_key UNIQUE (barcode);
-- ALTER TABLE customer_detail ADD CONSTRAINT customer_detail_email_key UNIQUE (email);
-- ALTER TABLE bill             ADD CONSTRAINT bill_bill_no_key    UNIQUE (bill_no);
-- ALTER TABLE damage_stock    ADD CONSTRAINT damage_stock_damage_no_key UNIQUE (damage_no);
-- ALTER TABLE sales_return    ADD CONSTRAINT sales_return_return_no_key UNIQUE (return_no);
-- ALTER TABLE rental_order    ADD CONSTRAINT rental_order_rental_no_key UNIQUE (rental_no);
-- ============================================================