package com.gosuas.core.dto;

public record SalesReturnItemRequest(
        String barcode,
        Integer returnedQty,
        Boolean restockable   // null treated as true
) {}