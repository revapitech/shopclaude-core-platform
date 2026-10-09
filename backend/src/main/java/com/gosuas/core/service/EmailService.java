package com.gosuas.core.service;

import com.gosuas.core.entity.DigitalOrder;
import com.gosuas.core.entity.DigitalProduct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import jakarta.mail.internet.MimeMessage;
import java.io.File;

@Service
@RequiredArgsConstructor
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;

    @Value("${spring.mail.username}")
    private String fromEmail;

    @Value("${app.mail.from-name:ShopClaude}")
    private String fromName;

    @Async
    public void sendDigitalProduct(DigitalOrder order, DigitalProduct product, String uploadDir) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom(fromEmail, fromName);
            helper.setTo(order.getCustomerEmail());
            helper.setSubject("Your Purchase: " + product.getTitle());

            String customerName = order.getCustomerName() != null ? order.getCustomerName() : "Customer";
            String passwordBlock = product.isPasswordProtected()
                ? "<div style='background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:14px 18px;margin:16px 0;'>"
                  + "<p style='margin:0 0 4px;font-size:13px;color:#92400e;font-weight:600;'>🔑 PDF Password</p>"
                  + "<p style='margin:0;font-size:20px;font-weight:800;letter-spacing:2px;color:#1f2937;font-family:monospace;'>"
                  + product.getPdfPassword() + "</p>"
                  + "<p style='margin:6px 0 0;font-size:12px;color:#6b7280;'>Use this password to open the attached PDF.</p></div>"
                : "";

            String html = """
                <!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Inter,Arial,sans-serif;background:#f9fafb;">
                <table width="100%%" cellpadding="0" cellspacing="0">
                  <tr><td align="center" style="padding:40px 20px;">
                    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                      <tr><td style="background:linear-gradient(135deg,#0A1628,#1E3A5F);padding:28px 36px;text-align:center;">
                        <div style="font-size:28px;margin-bottom:8px;">🏪</div>
                        <div style="color:#F5971E;font-size:20px;font-weight:800;letter-spacing:-0.5px;">theshopclaude</div>
                        <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:4px;">Digital Delivery</div>
                      </td></tr>
                      <tr><td style="padding:36px;">
                        <h2 style="color:#1f2937;margin:0 0 8px;font-size:22px;">Hi %s! 👋</h2>
                        <p style="color:#6b7280;margin:0 0 24px;font-size:15px;line-height:1.6;">Thank you for your purchase. Your document is attached to this email.</p>
                        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
                          <div style="font-size:28px;margin-bottom:8px;">%s</div>
                          <div style="font-size:16px;font-weight:700;color:#1f2937;">%s</div>
                          <div style="font-size:13px;color:#6b7280;margin-top:4px;">%s</div>
                          <div style="margin-top:12px;font-size:14px;font-weight:700;color:#16a34a;">✓ Payment Successful — ₹%s</div>
                        </div>
                        %s
                        <p style="color:#9ca3af;font-size:13px;margin-top:24px;">The PDF document is attached to this email. If you face any issues, please reply to this email.</p>
                      </td></tr>
                      <tr><td style="background:#f9fafb;padding:20px 36px;text-align:center;border-top:1px solid #e5e7eb;">
                        <p style="margin:0;font-size:12px;color:#9ca3af;">Powered by <strong style="color:#1E3A5F;">theshopclaude.com</strong></p>
                      </td></tr>
                    </table>
                  </td></tr>
                </table>
                </body></html>
                """.formatted(
                    customerName,
                    product.getCoverEmoji() != null ? product.getCoverEmoji() : "📄",
                    product.getTitle(),
                    product.getDescription() != null ? product.getDescription() : "",
                    order.getAmount().toPlainString(),
                    passwordBlock
                );

            helper.setText(html, true);

            // Resolve and attach PDF
            String relativePath = product.getPdfPath().replace("/uploads/pdfs/", "");
            File pdfFile = new File(uploadDir + "/pdfs/" + relativePath);
            if (pdfFile.exists()) {
                String safeTitle = product.getTitle().replaceAll("[^a-zA-Z0-9 _-]", "").trim().replace(' ', '_');
                helper.addAttachment(safeTitle + ".pdf", new FileSystemResource(pdfFile));
            } else {
                log.warn("PDF file not found at path: {}", pdfFile.getAbsolutePath());
            }

            mailSender.send(message);
            log.info("Digital product email sent to {} for '{}'", order.getCustomerEmail(), product.getTitle());

        } catch (Exception e) {
            log.error("Failed to send digital product email to {}: {}", order.getCustomerEmail(), e.getMessage(), e);
        }
    }
}
