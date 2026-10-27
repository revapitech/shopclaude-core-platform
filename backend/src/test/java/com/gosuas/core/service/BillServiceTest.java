package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.*;
import com.gosuas.core.entity.Bill;
import com.gosuas.core.entity.BillPayment;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.Tenant;
import com.gosuas.core.repository.BillRepository;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.TenantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class BillServiceTest {

    @Mock BillRepository billRepository;
    @Mock ProductRepository productRepository;
    @Mock TenantRepository tenantRepository;
    @Mock com.gosuas.core.repository.CustomerDetailRepository customerDetailRepository;
    @InjectMocks BillService billService;

    private UUID tenantId;
    private Product product;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        product = new Product();
        product.setId(UUID.randomUUID());
        product.setName("T-Shirt");
        product.setBarcode("BAR001");
        product.setSellingPrice(new BigDecimal("500.00"));

        when(productRepository.findByBarcodeAndTenantId("BAR001", tenantId))
                .thenReturn(Optional.of(product));
        when(productRepository.decrementStock(any(), eq(tenantId), anyInt())).thenReturn(1);
        when(billRepository.findAllByTenantIdAndBillNoStartingWith(any(), any()))
                .thenReturn(List.of());
        when(billRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        // Default: tenant not GST-registered — GST computation is skipped
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.empty());
        // Default: no existing customer for any phone — new customer will be created
        when(customerDetailRepository.findByTenantIdAndPhone(any(), any())).thenReturn(Optional.empty());
    }

    /** Helper: creates a GST-registered intra-state tenant for GST tests. */
    private Tenant gstTenant(String supplyType) {
        Tenant t = new Tenant();
        t.setGstRegistered(true);
        t.setGstin("29ABCDE1234F1Z5");
        t.setSupplyType(supplyType);
        return t;
    }

    // ── Test 1: Single CASH payment ─────────────────────────────────────────────
    @Test
    void t01_singleCashPayment() {
        BillRequest req = new BillRequest("Alice", "9000000001",
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("CASH");
        assertThat(res.payments()).isEmpty();
    }

    // ── Test 2: Single CARD payment ─────────────────────────────────────────────
    @Test
    void t02_singleCardPayment() {
        BillRequest req = new BillRequest("Bob", "9000000002",
                BigDecimal.ZERO, "CARD", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("CARD");
        assertThat(res.payments()).isEmpty();
    }

    // ── Test 3: Single QR payment ───────────────────────────────────────────────
    @Test
    void t03_singleQrPayment() {
        BillRequest req = new BillRequest("Carol", "9000000003",
                BigDecimal.ZERO, "QR", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("QR");
        assertThat(res.payments()).isEmpty();
    }

    // ── Test 4: Legacy UPI paymentMode (no splitPayments) ───────────────────────
    @Test
    void t04_legacyUpiPaymentMode() {
        BillRequest req = new BillRequest("Dave", null,
                BigDecimal.ZERO, "UPI", List.of(),
                List.of(new BillItemRequest("BAR001", 2)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("UPI");
        assertThat(res.payments()).isEmpty();
        assertThat(res.grandTotal()).isEqualByComparingTo("1000.00");
    }

    // ── Test 5: Split Cash + Card equals total → success ────────────────────────
    @Test
    void t05_splitCashAndCard_sumEqualsTotal() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("300.00")),
                new PaymentEntryRequest("CARD", new BigDecimal("200.00"))
        );
        BillRequest req = new BillRequest("Eve", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("SPLIT");
        assertThat(res.payments()).hasSize(2);
        assertThat(res.payments().stream().mapToDouble(p -> p.amount().doubleValue()).sum())
                .isEqualTo(500.0);
    }

    // ── Test 6: Split sum less than total → IllegalArgumentException ─────────────
    @Test
    void t06_splitSumLessThanTotal_throws() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("200.00")),
                new PaymentEntryRequest("CARD", new BigDecimal("100.00"))
        );
        BillRequest req = new BillRequest("Frank", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not match bill total");
    }

    // ── Test 7: Split sum greater than total → IllegalArgumentException ──────────
    @Test
    void t07_splitSumGreaterThanTotal_throws() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("400.00")),
                new PaymentEntryRequest("QR",   new BigDecimal("200.00"))
        );
        BillRequest req = new BillRequest("Grace", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not match bill total");
    }

    // ── Test 8: Split entry with zero amount → IllegalArgumentException ──────────
    @Test
    void t08_splitZeroAmount_throws() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("500.00")),
                new PaymentEntryRequest("CARD", BigDecimal.ZERO)
        );
        BillRequest req = new BillRequest("Heidi", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("amount must be greater than zero");
    }

    // ── Test 9: Split entry with negative amount → IllegalArgumentException ──────
    @Test
    void t09_splitNegativeAmount_throws() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("600.00")),
                new PaymentEntryRequest("CARD", new BigDecimal("-100.00"))
        );
        BillRequest req = new BillRequest("Ivan", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("amount must be greater than zero");
    }

    // ── Test 10: Split entry with blank method → IllegalArgumentException ─────────
    @Test
    void t10_splitBlankMethod_throws() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("  ", new BigDecimal("500.00"))
        );
        BillRequest req = new BillRequest("Judy", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("method must not be blank");
    }

    // ── Test 11: Decimal rounding — 49.99 + 50.01 = 100.00 (qty 2 × 50) ────────
    @Test
    void t11_splitDecimalRounding() {
        product.setSellingPrice(new BigDecimal("50.00"));

        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("49.99")),
                new PaymentEntryRequest("QR",   new BigDecimal("50.01"))
        );
        BillRequest req = new BillRequest("Karl", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 2)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("SPLIT");
        assertThat(res.grandTotal()).isEqualByComparingTo("100.00");
    }

    // ── Test 12: Single split entry covering full amount → SPLIT mode ────────────
    @Test
    void t12_singleSplitEntry_fullAmount() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("QR", new BigDecimal("500.00"))
        );
        BillRequest req = new BillRequest("Laura", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("SPLIT");
        assertThat(res.payments()).hasSize(1);
        assertThat(res.payments().get(0).method()).isEqualTo("QR");
    }

    // ── Test 13: Three-way split → success ──────────────────────────────────────
    @Test
    void t13_threeWaySplit() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("cash",  new BigDecimal("200.00")),
                new PaymentEntryRequest("card",  new BigDecimal("200.00")),
                new PaymentEntryRequest("upi",   new BigDecimal("100.00"))
        );
        BillRequest req = new BillRequest("Mallory", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("SPLIT");
        assertThat(res.payments()).hasSize(3);
        // method should be uppercased
        assertThat(res.payments().stream().map(PaymentEntryResponse::method))
                .containsExactlyInAnyOrder("CASH", "CARD", "UPI");
    }

    // ── Test 14: Discount reduces grand total; split must match grand total ───────
    @Test
    void t14_splitWithDiscount_sumMustMatchGrandTotal() {
        // 1 item × 500 − 50 discount = 450 grand total; split 250+150=400 ≠ 450 → throws
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("250.00")),
                new PaymentEntryRequest("CARD", new BigDecimal("150.00"))
        );
        BillRequest req = new BillRequest("Nina", null,
                new BigDecimal("50.00"), null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not match bill total");
    }

    // ── Test 15: Split matches discounted grand total → success ──────────────────
    @Test
    void t15_splitMatchesDiscountedGrandTotal() {
        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("250.00")),
                new PaymentEntryRequest("CARD", new BigDecimal("200.00"))
        );
        // 500 − 50 discount = 450; split = 250 + 200 = 450
        BillRequest req = new BillRequest("Oscar", null,
                new BigDecimal("50.00"), null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        // fix split to match
        List<PaymentEntryRequest> correctedSplit = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("250.00")),
                new PaymentEntryRequest("CARD", new BigDecimal("200.00"))
        );
        BillRequest corrected = new BillRequest("Oscar", null,
                new BigDecimal("50.00"), null, correctedSplit,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(corrected);

        assertThat(res.paymentMode()).isEqualTo("SPLIT");
        assertThat(res.grandTotal()).isEqualByComparingTo("450.00");
        assertThat(res.payments()).hasSize(2);
    }

    // ── Test 16: Stock decrement fails mid-bill — no payment rows persisted ───────
    @Test
    void t16_stockFailRollsBackPayments() {
        when(productRepository.decrementStock(any(), eq(tenantId), anyInt())).thenReturn(0);

        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("500.00"))
        );
        BillRequest req = new BillRequest("Pete", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        assertThatThrownBy(() -> billService.createBill(req))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Insufficient stock");

        // bill must not have been saved
        verify(billRepository, never()).save(any());
    }

    // ── Test 17: GST-unregistered tenant → no GST fields computed ───────────────
    @Test
    void t17_gstUnregisteredTenant_noGstComputed() {
        product.setGstRate(new BigDecimal("18"));
        BillRequest req = new BillRequest("Alice", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        // GST fields should be zero (not null) since we always initialise the bill fields
        assertThat(res.totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(res.cgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(res.sgst()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    // ── Test 18: GST-registered intra-state, 18% inclusive — CGST+SGST correct ──
    @Test
    void t18_gstIntraState18Percent() {
        product.setGstRate(new BigDecimal("18"));
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        // 1 × ₹500 (tax-inclusive at 18%)
        // taxable = 500 / 1.18 = 423.73; GST = 76.27; CGST = SGST = 38.14
        BillRequest req = new BillRequest("Bob", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.totalGst()).isGreaterThan(BigDecimal.ZERO);
        assertThat(res.cgst()).isEqualByComparingTo(res.sgst()); // CGST == SGST for intra-state
        assertThat(res.igst()).isEqualByComparingTo(BigDecimal.ZERO);
        // taxable + cgst + sgst should approximately equal grand total
        BigDecimal reconstituted = res.taxableAmount().add(res.cgst()).add(res.sgst());
        assertThat(reconstituted.doubleValue()).isCloseTo(res.grandTotal().doubleValue(), within(1.0));
    }

    // ── Test 19: GST-registered inter-state, 12% inclusive — IGST correct ────────
    @Test
    void t19_gstInterState12Percent() {
        product.setGstRate(new BigDecimal("12"));
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTER")));

        BillRequest req = new BillRequest("Carol", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.igst()).isGreaterThan(BigDecimal.ZERO);
        assertThat(res.cgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(res.sgst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(res.totalGst()).isEqualByComparingTo(res.igst());
    }

    // ── Test 20: GST 0% product — zero tax, full amount taxable ─────────────────
    @Test
    void t20_gstZeroPercent_noTax() {
        product.setGstRate(BigDecimal.ZERO);
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        BillRequest req = new BillRequest("Dave", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 2)));

        BillResponse res = billService.createBill(req);

        assertThat(res.totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(res.taxableAmount()).isEqualByComparingTo(res.grandTotal());
    }

    // ── Test 21: GST null product (no GST configured) — treated as 0% ───────────
    @Test
    void t21_gstNullRate_treatedAsExempt() {
        product.setGstRate(null); // no GST configured
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        BillRequest req = new BillRequest("Eve", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.totalGst()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(res.taxableAmount()).isEqualByComparingTo(res.grandTotal());
    }

    // ── Test 22: Discount + GST — tax computed on post-discount value ────────────
    @Test
    void t22_discountBeforeGst() {
        product.setGstRate(new BigDecimal("18"));
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        // 1 × ₹500, ₹50 discount → grand total ₹450
        BillRequest req = new BillRequest("Frank", null,
                new BigDecimal("50.00"), "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.grandTotal()).isEqualByComparingTo("450.00");
        // taxable + cgst + sgst should approximately equal ₹450
        BigDecimal reconstituted = res.taxableAmount().add(res.cgst()).add(res.sgst());
        assertThat(reconstituted.doubleValue()).isCloseTo(450.0, within(1.0));
        // GST on discounted amount should be less than on full ₹500
        assertThat(res.totalGst().doubleValue()).isLessThan(500.0 - 500.0 / 1.18);
    }

    // ── Test 23: Split payment + GST — no duplication of tax totals ─────────────
    @Test
    void t23_splitPaymentDoesNotDuplicateGst() {
        product.setGstRate(new BigDecimal("18"));
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        List<PaymentEntryRequest> split = List.of(
                new PaymentEntryRequest("CASH", new BigDecimal("250.00")),
                new PaymentEntryRequest("QR",   new BigDecimal("250.00"))
        );
        BillRequest req = new BillRequest("Grace", null,
                BigDecimal.ZERO, null, split,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        assertThat(res.paymentMode()).isEqualTo("SPLIT");
        // GST must still be computed once — not once per payment leg
        BigDecimal reconstituted = res.taxableAmount().add(res.cgst()).add(res.sgst());
        assertThat(reconstituted.doubleValue()).isCloseTo(500.0, within(1.0));
    }

    // ── Test 24: 5% GST — verify CGST and SGST each equal 2.5% of taxable ───────
    @Test
    void t24_gst5Percent_correctSplit() {
        product.setSellingPrice(new BigDecimal("1050.00")); // ₹1050 tax-inclusive at 5%
        product.setGstRate(new BigDecimal("5"));
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        BillRequest req = new BillRequest("Heidi", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        // taxable = 1050 / 1.05 = 1000; GST = 50; CGST = SGST = 25
        assertThat(res.taxableAmount().doubleValue()).isCloseTo(1000.0, within(1.0));
        assertThat(res.cgst().doubleValue()).isCloseTo(25.0, within(1.0));
        assertThat(res.sgst().doubleValue()).isCloseTo(25.0, within(1.0));
    }

    // ── Test 25: 28% GST — highest rate, verify arithmetic ───────────────────────
    @Test
    void t25_gst28Percent() {
        product.setGstRate(new BigDecimal("28"));
        when(tenantRepository.findById(tenantId)).thenReturn(Optional.of(gstTenant("INTRA")));

        BillRequest req = new BillRequest("Ivan", null,
                BigDecimal.ZERO, "CASH", null,
                List.of(new BillItemRequest("BAR001", 1)));

        BillResponse res = billService.createBill(req);

        // taxable = 500 / 1.28 ≈ 390.63; GST ≈ 109.37; CGST = SGST ≈ 54.69
        assertThat(res.taxableAmount().doubleValue()).isCloseTo(390.0, within(2.0));
        assertThat(res.totalGst().doubleValue()).isCloseTo(109.0, within(2.0));
        assertThat(res.cgst()).isEqualByComparingTo(res.sgst());
    }
}
