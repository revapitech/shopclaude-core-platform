package com.gosuas.core.service;

import com.gosuas.core.config.TenantContext;
import com.gosuas.core.dto.RentalRequest;
import com.gosuas.core.dto.RentalResponse;
import com.gosuas.core.dto.RentalReturnRequest;
import com.gosuas.core.entity.Product;
import com.gosuas.core.entity.RentalOrder;
import com.gosuas.core.repository.ProductRepository;
import com.gosuas.core.repository.RentalOrderRepository;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class RentalService {
    private final RentalOrderRepository rentalRepository;
    private final ProductRepository productRepository;

    @Transactional
    public RentalResponse createRental(RentalRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        Product product = productRepository.findByBarcodeAndTenantId(request.productCode(), tenantId)
                .or(() -> productRepository.findBySkuAndTenantId(request.productCode(), tenantId))
                .orElseThrow(() -> new RuntimeException("Product not found for code: " + request.productCode()));

        if (!Boolean.TRUE.equals(product.getRentalAvailable())) {
            throw new RuntimeException(product.getName() + " is not marked as available for rental. Enable it from Inventory first.");
        }

        if (request.bookingDate() == null) {
            throw new RuntimeException("Booking date is required.");
        }
        int eventPeriodDays = request.eventPeriodDays() == null || request.eventPeriodDays() < 1 ? 1 : request.eventPeriodDays();
        int quantity = request.quantity() == null || request.quantity() < 1 ? 1 : request.quantity();

        LocalDate startDate = request.bookingDate();
        LocalDate endDate = startDate.plusDays(eventPeriodDays - 1);

        checkAvailability(tenantId, product, startDate, endDate, quantity, null);

        BigDecimal advance = request.advanceAmount() == null ? BigDecimal.ZERO : request.advanceAmount();
        BigDecimal deposit = request.depositAmount() == null ? BigDecimal.ZERO : request.depositAmount();
        BigDecimal rent    = request.rentAmount()    == null ? BigDecimal.ZERO : request.rentAmount();

        RentalOrder rental = RentalOrder.builder()
                .tenantId(tenantId)
                .rentalNo(generateRentalNo(tenantId))
                .productCode(product.getBarcode())
                .productName(product.getName())
                .quantity(quantity)
                .advanceAmount(advance)
                .depositAmount(deposit)
                .rentAmount(rent)
                .totalAmount(advance.add(deposit).add(rent))
                .customerName(request.customerName() == null || request.customerName().isBlank() ? "Walk-in Customer" : request.customerName())
                .customerMobile(request.customerMobile())
                .bookingDate(startDate)
                .eventPeriodDays(eventPeriodDays)
                .bookingEndDate(endDate)
                .build();

        return mapToResponse(rentalRepository.save(rental));
    }

    // Advance-only bookings are common — the customer pays the rest (rent/deposit) later on
    // pickup. This lets staff amend an existing rental in place instead of delete+recreate.
    @Transactional
    public RentalResponse updateRental(UUID id, RentalRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RentalOrder rental = rentalRepository.findById(id)
                .filter(r -> tenantId.equals(r.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Rental not found"));

        Product product = productRepository.findByBarcodeAndTenantId(rental.getProductCode(), tenantId)
                .orElseThrow(() -> new RuntimeException("Product not found for code: " + rental.getProductCode()));

        if (request.bookingDate() == null) {
            throw new RuntimeException("Booking date is required.");
        }
        int eventPeriodDays = request.eventPeriodDays() == null || request.eventPeriodDays() < 1 ? 1 : request.eventPeriodDays();
        int quantity = request.quantity() == null || request.quantity() < 1 ? 1 : request.quantity();
        LocalDate startDate = request.bookingDate();
        LocalDate endDate = startDate.plusDays(eventPeriodDays - 1);

        checkAvailability(tenantId, product, startDate, endDate, quantity, rental.getId());

        BigDecimal advance = request.advanceAmount() == null ? BigDecimal.ZERO : request.advanceAmount();
        BigDecimal deposit = request.depositAmount() == null ? BigDecimal.ZERO : request.depositAmount();
        BigDecimal rent    = request.rentAmount()    == null ? BigDecimal.ZERO : request.rentAmount();

        rental.setQuantity(quantity);
        rental.setAdvanceAmount(advance);
        rental.setDepositAmount(deposit);
        rental.setRentAmount(rent);
        rental.setTotalAmount(advance.add(deposit).add(rent));
        rental.setCustomerName(request.customerName() == null || request.customerName().isBlank() ? "Walk-in Customer" : request.customerName());
        rental.setCustomerMobile(request.customerMobile());
        rental.setBookingDate(startDate);
        rental.setEventPeriodDays(eventPeriodDays);
        rental.setBookingEndDate(endDate);

        return mapToResponse(rentalRepository.save(rental));
    }

    // Availability = total stock minus whatever's already booked (RENTED, not yet RETURNED) on
    // any date range overlapping the requested one, optionally excluding the rental being edited.
    // Stock itself is never mutated — this is a date-based reservation, not a stock deduction.
    private void checkAvailability(UUID tenantId, Product product, LocalDate startDate, LocalDate endDate, int quantity, UUID excludeRentalId) {
        List<RentalOrder> existing = rentalRepository.findAllByTenantIdAndProductCode(tenantId, product.getBarcode());
        int alreadyBooked = existing.stream()
                .filter(r -> excludeRentalId == null || !excludeRentalId.equals(r.getId()))
                .filter(r -> !"RETURNED".equals(r.getStatus()))
                .filter(r -> r.getBookingDate() != null && r.getBookingEndDate() != null)
                .filter(r -> !r.getBookingEndDate().isBefore(startDate) && !r.getBookingDate().isAfter(endDate))
                .mapToInt(r -> r.getQuantity() == null ? 0 : r.getQuantity())
                .sum();

        int available = (product.getStockQty() == null ? 0 : product.getStockQty()) - alreadyBooked;
        if (quantity > available) {
            throw new RuntimeException(product.getName() + " is already booked for these dates ("
                    + available + " of " + product.getStockQty() + " unit(s) free " + startDate + " to " + endDate + ").");
        }
    }

    @Transactional
    public List<RentalResponse> listRentals() {
        return rentalRepository.findAllByTenantIdOrderByRentedAtDesc(TenantContext.getTenantId()).stream()
                .map(this::mapToResponse)
                .toList();
    }

    // Deposit refund = deposit collected minus any damage deduction. Tracked on the rental so
    // it can be surfaced in Reports separately from revenue — it's money handed back, not earned.
    @Transactional
    public RentalResponse markReturned(UUID id, RentalReturnRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RentalOrder rental = rentalRepository.findById(id)
                .filter(r -> tenantId.equals(r.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Rental not found"));

        if (!"RETURNED".equals(rental.getStatus())) {
            BigDecimal deposit = rental.getDepositAmount() == null ? BigDecimal.ZERO : rental.getDepositAmount();
            BigDecimal deduction = request != null && request.deductionAmount() != null ? request.deductionAmount() : BigDecimal.ZERO;
            if (deduction.signum() < 0) deduction = BigDecimal.ZERO;
            if (deduction.compareTo(deposit) > 0) deduction = deposit;
            BigDecimal refund = deposit.subtract(deduction);

            rental.setStatus("RETURNED");
            rental.setDeductionAmount(deduction);
            rental.setRefundAmount(refund);
            rental.setReturnNotes(request != null ? request.returnNotes() : null);
            LocalDate returnDate = request != null ? request.returnDate() : null;
            rental.setReturnedAt(returnDate != null ? returnDate.atTime(LocalDateTime.now().toLocalTime()) : LocalDateTime.now());
        }
        return mapToResponse(rentalRepository.save(rental));
    }

    @Transactional
    public void deleteRental(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        RentalOrder rental = rentalRepository.findById(id)
                .filter(r -> tenantId.equals(r.getTenantId()))
                .orElseThrow(() -> new RuntimeException("Rental not found"));
        rentalRepository.delete(rental);
    }

    private RentalResponse mapToResponse(RentalOrder r) {
        return new RentalResponse(
                r.getId(), r.getRentalNo(), r.getProductCode(), r.getProductName(), r.getQuantity(),
                r.getAdvanceAmount(), r.getDepositAmount(), r.getRentAmount(), r.getTotalAmount(),
                r.getCustomerName(), r.getCustomerMobile(),
                r.getBookingDate(), r.getEventPeriodDays(), r.getBookingEndDate(),
                r.getStatus(), r.getDeductionAmount(), r.getRefundAmount(), r.getReturnNotes(),
                r.getRentedAt(), r.getReturnedAt());
    }

    // MAX-based, not COUNT-based — a rejected booking (dates already taken, etc.) rolls back
    // and leaves a gap, which would make count-based numbering collide on the same number
    // forever. See BillService.generateBillNo for the same fix and the full explanation.
    private String generateRentalNo(UUID tenantId) {
        String prefix = "RENT-" + LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE) + "-";
        int maxSeq = rentalRepository.findAllByTenantIdAndRentalNoStartingWith(tenantId, prefix).stream()
                .mapToInt(r -> {
                    try { return Integer.parseInt(r.getRentalNo().substring(prefix.length())); }
                    catch (Exception e) { return 0; }
                })
                .max().orElse(0);
        long count = maxSeq + 1;
        return prefix + String.format("%04d", count);
    }
}
