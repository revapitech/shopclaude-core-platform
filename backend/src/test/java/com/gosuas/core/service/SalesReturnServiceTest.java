package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.SalesReturnItemRequest;
import com.gosuas.core.dto.SalesReturnRequest;
import com.gosuas.core.dto.SalesReturnResponse;
import com.gosuas.core.entity.*;
import com.gosuas.core.repository.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class SalesReturnServiceTest {

    @Mock private SalesReturnRepository returnRepository;
    @Mock private BillRepository        billRepository;
    @Mock private ShopOrderRepository   shopOrderRepository;
    @Mock private ProductRepository     productRepository;
    @InjectMocks private SalesReturnService service;

    private final UUID tenantId   = UUID.randomUUID();
    private final UUID billId     = UUID.randomUUID();
    private final UUID productId  = UUID.randomUUID();

    @BeforeEach void setTenant()   { TenantContext.setTenantId(tenantId); }
    @AfterEach  void clearTenant() { TenantContext.clear(); }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private Product makeProduct(int stock) {
        return Product.builder().id(productId).tenantId(tenantId).name("Shirt").stockQty(stock).build();
    }

    private Bill makeBill(String barcode, int qty) {
        Product p = makeProduct(qty);
        BillItem item = BillItem.builder()
                .product(p).productName("Shirt").barcode(barcode)
                .quantity(qty).unitPrice(new BigDecimal("499"))
                .lineTotal(new BigDecimal("499").multiply(BigDecimal.valueOf(qty)))
                .build();
        Bill bill = Bill.builder()
                .id(billId).tenantId(tenantId).billNo("GOS-20241013-0001")
                .customerName("Alice").customerMobile("9876543210")
                .build();
        bill.getItems().add(item);
        return bill;
    }

    private SalesReturn makePendingReturn(String barcode, int qty) {
        SalesReturnItem item = SalesReturnItem.builder()
                .productId(productId).productName("Shirt").barcode(barcode)
                .returnedQty(qty).unitPrice(new BigDecimal("499"))
                .lineTotal(new BigDecimal("499").multiply(BigDecimal.valueOf(qty)))
                .restockable(true).build();
        SalesReturn ret = SalesReturn.builder()
                .id(UUID.randomUUID()).tenantId(tenantId)
                .returnNo("RET-20241013-0001").sourceType("POS").sourceBillId(billId)
                .sourceBillNo("GOS-20241013-0001").status("PENDING").stockRestored(false)
                .totalReturnAmount(new BigDecimal("499").multiply(BigDecimal.valueOf(qty)))
                .build();
        item.setSalesReturn(ret);
        ret.setItems(List.of(item));
        return ret;
    }

    // ── Test 1: create return against POS bill ────────────────────────────────

    @Test
    void createReturn_posSource_savesReturn() {
        when(billRepository.findById(billId)).thenReturn(Optional.of(makeBill("BAR001", 5)));
        when(returnRepository.sumReturnedQtyByBillAndBarcode(tenantId, billId, "BAR001")).thenReturn(0);
        when(returnRepository.findAllByTenantIdAndReturnNoStartingWith(eq(tenantId), anyString())).thenReturn(List.of());
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        SalesReturnRequest req = new SalesReturnRequest(
                "POS", billId, null, null, null, "DEFECTIVE", null, "CASH",
                List.of(new SalesReturnItemRequest("BAR001", 2, true)));

        SalesReturnResponse res = service.createReturn(req);

        assertThat(res.status()).isEqualTo("PENDING");
        assertThat(res.sourceBillNo()).isEqualTo("GOS-20241013-0001");
        assertThat(res.items()).hasSize(1);
        assertThat(res.items().get(0).returnedQty()).isEqualTo(2);
        assertThat(res.totalReturnAmount()).isEqualByComparingTo("998");
    }

    // ── Test 2: return qty exceeds original qty is rejected ───────────────────

    @Test
    void createReturn_exceedsOriginalQty_throws() {
        when(billRepository.findById(billId)).thenReturn(Optional.of(makeBill("BAR001", 3)));
        when(returnRepository.sumReturnedQtyByBillAndBarcode(tenantId, billId, "BAR001")).thenReturn(0);

        SalesReturnRequest req = new SalesReturnRequest(
                "POS", billId, null, null, null, null, null, null,
                List.of(new SalesReturnItemRequest("BAR001", 5, true)));

        assertThatThrownBy(() -> service.createReturn(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("exceeds returnable qty");
    }

    // ── Test 3: partial prior returns reduce returnable qty ────────────────────

    @Test
    void createReturn_partialPriorReturn_reducesReturnableQty() {
        when(billRepository.findById(billId)).thenReturn(Optional.of(makeBill("BAR001", 5)));
        // 3 already returned → only 2 left
        when(returnRepository.sumReturnedQtyByBillAndBarcode(tenantId, billId, "BAR001")).thenReturn(3);

        SalesReturnRequest req = new SalesReturnRequest(
                "POS", billId, null, null, null, null, null, null,
                List.of(new SalesReturnItemRequest("BAR001", 3, true)));

        assertThatThrownBy(() -> service.createReturn(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("exceeds returnable qty 2");
    }

    // ── Test 4: zero return qty is rejected ────────────────────────────────────

    @Test
    void createReturn_zeroQty_throws() {
        SalesReturnRequest req = new SalesReturnRequest(
                "POS", billId, null, null, null, null, null, null,
                List.of(new SalesReturnItemRequest("BAR001", 0, true)));

        assertThatThrownBy(() -> service.createReturn(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("greater than zero");
    }

    // ── Test 5: APPROVED restores stock for restockable items ─────────────────

    @Test
    void updateStatus_approved_restoresStock() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.updateStatus(ret.getId(), "APPROVED");

        verify(productRepository).restoreStock(productId, tenantId, 2);
        assertThat(ret.isStockRestored()).isTrue();
        assertThat(ret.getStatus()).isEqualTo("APPROVED");
    }

    // ── Test 6: stockRestored flag prevents double restoration ────────────────

    @Test
    void updateStatus_approvedTwice_doesNotRestoreStockTwice() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        ret.setStockRestored(true); // simulate already restored
        ret.setStatus("APPROVED");
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));

        // APPROVED → COMPLETED (second call; stockRestored already true)
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        service.updateStatus(ret.getId(), "COMPLETED");

        verify(productRepository, never()).restoreStock(any(), any(), anyInt());
    }

    // ── Test 7: CANCELLED after APPROVED reverses the stock ───────────────────

    @Test
    void updateStatus_cancelledAfterApproved_reversesStock() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        ret.setStatus("APPROVED");
        ret.setStockRestored(true);
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(productRepository.decrementStock(productId, tenantId, 2)).thenReturn(1);

        service.updateStatus(ret.getId(), "CANCELLED");

        verify(productRepository).decrementStock(productId, tenantId, 2);
        assertThat(ret.isStockRestored()).isFalse();
        assertThat(ret.getStatus()).isEqualTo("CANCELLED");
    }

    // ── Test 8: non-restockable items are skipped during restoration ──────────

    @Test
    void updateStatus_approved_nonRestockableItemsSkipped() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        ret.getItems().get(0).setRestockable(false);
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.updateStatus(ret.getId(), "APPROVED");

        verify(productRepository, never()).restoreStock(any(), any(), anyInt());
        assertThat(ret.isStockRestored()).isTrue(); // flag still set (nothing to undo)
    }

    // ── Test 9: SHOPIFY returns never touch stock ─────────────────────────────

    @Test
    void updateStatus_shopifyReturn_doesNotRestoreStock() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        ret.setSourceType("SHOPIFY");
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.updateStatus(ret.getId(), "APPROVED");

        verify(productRepository, never()).restoreStock(any(), any(), anyInt());
    }

    // ── Test 10: invalid status transition is rejected ────────────────────────

    @Test
    void updateStatus_completedToApproved_throws() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        ret.setStatus("COMPLETED");
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));

        assertThatThrownBy(() -> service.updateStatus(ret.getId(), "APPROVED"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Cannot transition");
    }

    // ── Test 11: barcode not in original sale is rejected ─────────────────────

    @Test
    void createReturn_unknownBarcode_throws() {
        when(billRepository.findById(billId)).thenReturn(Optional.of(makeBill("BAR001", 5)));

        SalesReturnRequest req = new SalesReturnRequest(
                "POS", billId, null, null, null, null, null, null,
                List.of(new SalesReturnItemRequest("UNKNOWN", 1, true)));

        assertThatThrownBy(() -> service.createReturn(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not found in the original sale");
    }

    // ── Test 12: DIRECT return creates return and restores stock on approval ──

    @Test
    void createReturn_directSource_savesReturn() {
        Product p = makeProduct(10);
        p.setName("Shirt");
        p.setBarcode("BAR001");

        when(productRepository.findByBarcodeAndTenantId("BAR001", tenantId)).thenReturn(Optional.of(p));
        when(returnRepository.findAllByTenantIdAndReturnNoStartingWith(eq(tenantId), anyString())).thenReturn(List.of());
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        SalesReturnRequest req = new SalesReturnRequest(
                "DIRECT", null, "Bob", "9876543210", null, "DEFECTIVE", null, "CASH",
                List.of(new SalesReturnItemRequest("BAR001", 1, true)));

        SalesReturnResponse res = service.createReturn(req);

        assertThat(res.status()).isEqualTo("PENDING");
        assertThat(res.sourceBillNo()).isEqualTo("DIRECT");
        assertThat(res.customerName()).isEqualTo("Bob");
        assertThat(res.items()).hasSize(1);
        assertThat(res.items().get(0).returnedQty()).isEqualTo(1);
    }

    // ── Test 13: DIRECT return with unknown barcode is rejected ───────────────

    @Test
    void createReturn_directSource_unknownBarcode_throws() {
        when(productRepository.findByBarcodeAndTenantId("UNKNOWN", tenantId)).thenReturn(Optional.empty());

        SalesReturnRequest req = new SalesReturnRequest(
                "DIRECT", null, null, null, null, null, null, null,
                List.of(new SalesReturnItemRequest("UNKNOWN", 1, true)));

        assertThatThrownBy(() -> service.createReturn(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Product not found for barcode");
    }

    // ── Test 14: product lookup finds product by SKU ──────────────────────────

    @Test
    void lookupProductForReturn_foundBySku() {
        Product p = Product.builder()
                .id(productId).tenantId(tenantId)
                .name("Shirt").sku("SKU-001").barcode("BAR001")
                .sellingPrice(new BigDecimal("299")).stockQty(8).build();
        when(productRepository.findBySkuAndTenantId("SKU-001", tenantId)).thenReturn(Optional.of(p));

        Map<String, Object> result = service.lookupProductForReturn("SKU-001");

        assertThat(result.get("sku")).isEqualTo("SKU-001");
        assertThat(result.get("barcode")).isEqualTo("BAR001");
        assertThat(result.get("stockQty")).isEqualTo(8);
        assertThat(result.get("sellingPrice")).isEqualTo(new BigDecimal("299"));
        // barcode lookup should not be invoked when SKU matches
        verify(productRepository, never()).findByBarcodeAndTenantId(any(), any());
    }

    // ── Test 15: product lookup falls back to barcode when SKU misses ─────────

    @Test
    void lookupProductForReturn_fallsBackToBarcode() {
        Product p = Product.builder()
                .id(productId).tenantId(tenantId)
                .name("Cap").sku("CAP-001").barcode("BAR999")
                .sellingPrice(new BigDecimal("149")).stockQty(5).build();
        when(productRepository.findBySkuAndTenantId("BAR999", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findByBarcodeAndTenantId("BAR999", tenantId)).thenReturn(Optional.of(p));

        Map<String, Object> result = service.lookupProductForReturn("BAR999");

        assertThat(result.get("barcode")).isEqualTo("BAR999");
        assertThat(result.get("stockQty")).isEqualTo(5);
    }

    // ── Test 16: product lookup throws when neither SKU nor barcode matches ───

    @Test
    void lookupProductForReturn_notFound_throws() {
        when(productRepository.findBySkuAndTenantId("UNKNOWN", tenantId)).thenReturn(Optional.empty());
        when(productRepository.findByBarcodeAndTenantId("UNKNOWN", tenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.lookupProductForReturn("UNKNOWN"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("not found");
    }

    // ── Test 17: PENDING → REJECTED does not touch stock ─────────────────────

    @Test
    void updateStatus_pendingToRejected_doesNotTouchStock() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.updateStatus(ret.getId(), "REJECTED");

        verify(productRepository, never()).restoreStock(any(), any(), anyInt());
        verify(productRepository, never()).decrementStock(any(), any(), anyInt());
        assertThat(ret.getStatus()).isEqualTo("REJECTED");
    }

    // ── Test 18: PENDING → CANCELLED (never approved) does not touch stock ───

    @Test
    void updateStatus_pendingToCancelledBeforeApproval_doesNotTouchStock() {
        SalesReturn ret = makePendingReturn("BAR001", 2);
        // stockRestored is false — return was never approved
        assertThat(ret.isStockRestored()).isFalse();
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.updateStatus(ret.getId(), "CANCELLED");

        verify(productRepository, never()).restoreStock(any(), any(), anyInt());
        verify(productRepository, never()).decrementStock(any(), any(), anyInt());
        assertThat(ret.getStatus()).isEqualTo("CANCELLED");
    }

    // ── Test 19: approving a DIRECT return restores stock via product ID ──────

    @Test
    void updateStatus_directReturnApproved_restoresStock() {
        SalesReturn ret = makePendingReturn("BAR001", 3);
        ret.setSourceType("DIRECT");
        ret.setSourceBillId(null);
        when(returnRepository.findById(ret.getId())).thenReturn(Optional.of(ret));
        when(returnRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        service.updateStatus(ret.getId(), "APPROVED");

        verify(productRepository).restoreStock(productId, tenantId, 3);
        assertThat(ret.isStockRestored()).isTrue();
        assertThat(ret.getStatus()).isEqualTo("APPROVED");
    }

    // ── Test 20: getPreview for POS bill returns only still-returnable items ──

    @Test
    @SuppressWarnings("unchecked")
    void getPreview_posSource_returnsReturnableItems() {
        Bill bill = makeBill("BAR001", 5);
        when(billRepository.findByBillNoAndTenantId("GOS-20241013-0001", tenantId))
                .thenReturn(Optional.of(bill));
        when(returnRepository.sumReturnedQtyByBillAndBarcode(tenantId, billId, "BAR001"))
                .thenReturn(2); // 2 already returned → only 3 left

        Map<String, Object> result = service.getPreview("POS", "GOS-20241013-0001");

        assertThat(result.get("sourceType")).isEqualTo("POS");
        assertThat(result.get("customerName")).isEqualTo("Alice");
        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        assertThat(items).hasSize(1);
        assertThat(items.get(0).get("returnableQty")).isEqualTo(3);
        assertThat(items.get(0).get("barcode")).isEqualTo("BAR001");
        assertThat(items.get(0).get("originalQty")).isEqualTo(5);
    }
}
