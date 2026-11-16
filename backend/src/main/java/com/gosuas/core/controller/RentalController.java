package com.gosuas.core.controller;

import com.gosuas.core.dto.RentalRequest;
import com.gosuas.core.dto.RentalResponse;
import com.gosuas.core.dto.RentalReturnRequest;
import com.gosuas.core.service.RentalService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/rentals")
@RequiredArgsConstructor
public class RentalController {
    private final RentalService rentalService;

    @GetMapping
    public List<RentalResponse> list() {
        return rentalService.listRentals();
    }

    @PostMapping
    public RentalResponse create(@RequestBody RentalRequest request) {
        return rentalService.createRental(request);
    }

    @PutMapping("/{id}")
    public RentalResponse update(@PathVariable UUID id, @RequestBody RentalRequest request) {
        return rentalService.updateRental(id, request);
    }

    @PutMapping("/{id}/return")
    public RentalResponse markReturned(@PathVariable UUID id, @RequestBody(required = false) RentalReturnRequest request) {
        return rentalService.markReturned(id, request);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable UUID id) {
        rentalService.deleteRental(id);
    }
}
