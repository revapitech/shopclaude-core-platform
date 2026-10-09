package com.gosuas.core.controller;

import com.gosuas.core.service.BarcodeService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/barcodes")
@RequiredArgsConstructor
public class BarcodeController {
    private final BarcodeService barcodeService;

    @GetMapping(value = "/{value}", produces = MediaType.IMAGE_PNG_VALUE)
    public byte[] generate(@PathVariable String value) {
        return barcodeService.generateCode128Png(value);
    }
}
