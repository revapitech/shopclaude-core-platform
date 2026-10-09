package com.gosuas.core.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.Writer;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.oned.Code128Writer;
import com.google.zxing.oned.EAN13Writer;
import org.springframework.stereotype.Service;
import java.io.ByteArrayOutputStream;

@Service
public class BarcodeService {
    public byte[] generateCode128Png(String value) {
        try {
            // Use EAN-13 format for 13-digit numeric barcodes (universally scannable)
            boolean isEan13 = value != null && value.matches("\\d{13}");
            Writer writer = isEan13 ? new EAN13Writer() : new Code128Writer();
            BarcodeFormat format = isEan13 ? BarcodeFormat.EAN_13 : BarcodeFormat.CODE_128;
            BitMatrix matrix = writer.encode(value, format, 360, 120);
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(matrix, "PNG", outputStream);
            return outputStream.toByteArray();
        } catch (Exception e) {
            throw new RuntimeException("Barcode generation failed", e);
        }
    }
}
