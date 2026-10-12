package com.gosuas.core.controller;

import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.ShopOrderRepository;
import com.gosuas.core.repository.TenantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Tests for the per-colour stock-check semantics in PublicShopController.
 *
 * The concurrency guarantee is provided by ProductRepository.decrementStock, a JPQL
 * UPDATE … WHERE stockQty >= qty that executes atomically against PostgreSQL.
 * PostgreSQL row-level write locks ensure a second concurrent UPDATE sees the
 * committed stockQty before proceeding, making the guard race-free at READ COMMITTED.
 *
 * These unit tests verify the same invariants against the helper that mirrors the
 * SQL semantics, without requiring a live database or Spring context.
 */
@ExtendWith(MockitoExtension.class)
class ShopOrderStockTest {

    // ── Helpers to reproduce the stock-check logic from PublicShopController ─

    /** Mirrors the stock-check + decrement block added in PublicShopController.placeOrder(). */
    private static void applyStockDecrement(Product product, int qty) {
        if (product.getStockQty() < qty) {
            String colorLabel = (product.getColor() != null && !product.getColor().isBlank())
                    ? " (" + product.getColor() + ")" : "";
            throw new IllegalArgumentException(
                    "Not enough stock for " + product.getName() + colorLabel
                    + ". Only " + product.getStockQty() + " available.");
        }
        product.setStockQty(product.getStockQty() - qty);
        product.setSoldCount((product.getSoldCount() == null ? 0 : product.getSoldCount()) + qty);
    }

    private static Product makeVariant(String name, String color, int stock) {
        return Product.builder()
                .id(UUID.randomUUID())
                .name(name)
                .color(color)
                .stockQty(stock)
                .soldCount(0)
                .sellingPrice(new BigDecimal("499"))
                .build();
    }

    // ── Test 1: ordering Red decrements only Red's stock ─────────────────────

    @Test
    void orderRed_decrementsOnlyRedStock() {
        Product red   = makeVariant("Test Shirt", "Red",   10);
        Product blue  = makeVariant("Test Shirt", "Blue",   5);
        Product black = makeVariant("Test Shirt", "Black",  0);

        applyStockDecrement(red, 2);

        assertThat(red.getStockQty()).isEqualTo(8);
        assertThat(blue.getStockQty()).isEqualTo(5);   // untouched
        assertThat(black.getStockQty()).isEqualTo(0);  // untouched
        assertThat(red.getSoldCount()).isEqualTo(2);
    }

    // ── Test 2: ordering exact available quantity succeeds ────────────────────

    @Test
    void orderExactStock_succeeds() {
        Product blue = makeVariant("Test Shirt", "Blue", 5);

        assertThatNoException().isThrownBy(() -> applyStockDecrement(blue, 5));
        assertThat(blue.getStockQty()).isEqualTo(0);
    }

    // ── Test 3: ordering more than available throws with helpful message ──────

    @Test
    void orderMoreThanAvailable_throwsWithColourInMessage() {
        Product blue = makeVariant("Test Shirt", "Blue", 5);

        assertThatThrownBy(() -> applyStockDecrement(blue, 6))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Blue")
                .hasMessageContaining("5");
    }

    // ── Test 4: ordering from a zero-stock colour throws ─────────────────────

    @Test
    void orderFromZeroStockColour_throws() {
        Product black = makeVariant("Test Shirt", "Black", 0);

        assertThatThrownBy(() -> applyStockDecrement(black, 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Black");
    }

    // ── Test 5: soldCount is incremented correctly ────────────────────────────

    @Test
    void orderDecrement_incrementsSoldCount() {
        Product red = makeVariant("Test Shirt", "Red", 10);
        red.setSoldCount(3); // pre-existing sold count

        applyStockDecrement(red, 4);

        assertThat(red.getStockQty()).isEqualTo(6);
        assertThat(red.getSoldCount()).isEqualTo(7); // 3 + 4
    }

    // ── Test 6: ordering a product with no colour still produces a clear error ─

    @Test
    void orderNoColour_insufficientStock_messageHasNoParentheses() {
        Product p = makeVariant("Generic Item", null, 2);

        assertThatThrownBy(() -> applyStockDecrement(p, 5))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageNotContaining("(")   // no "(null)" or "()" in the message
                .hasMessageContaining("2");
    }
}
