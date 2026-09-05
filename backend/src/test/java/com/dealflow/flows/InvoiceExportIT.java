package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.billing.models.Invoice;
import com.dealflow.billing.models.InvoiceLine;
import com.dealflow.billing.repo.InvoiceLineRepository;
import com.dealflow.billing.repo.InvoiceRepository;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.shared.time.BusinessClock;
import com.dealflow.support.AbstractIntegrationTest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

class InvoiceExportIT extends AbstractIntegrationTest {

    @Autowired
    InvoiceRepository invoices;
    @Autowired
    InvoiceLineRepository invoiceLines;
    @Autowired
    BusinessClock clock;

    @Test
    @DisplayName("internal finance can export invoice as pdf, excel, and word")
    void internalFinanceExportAllFormats() {
        Customer customer = customer("Enterprise Corp", CustomerTier.GOLD);
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        String token = tokenFor(finance);

        Invoice inv = createTestInvoice(customer.getId());

        // 1. PDF export
        ResponseEntity<byte[]> pdfRes = get("/api/v1/invoices/" + inv.getId() + "/export?format=pdf", token)
                .retrieve().toEntity(byte[].class);
        assertThat(pdfRes.getStatusCode().value()).isEqualTo(200);
        assertThat(pdfRes.getHeaders().getContentType().toString()).contains("application/pdf");
        assertThat(pdfRes.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).contains("invoice-" + inv.getReference() + ".pdf");
        byte[] pdfBytes = pdfRes.getBody();
        assertThat(pdfBytes).isNotNull().isNotEmpty();
        assertThat(new String(pdfBytes, 0, Math.min(5, pdfBytes.length), StandardCharsets.US_ASCII)).isEqualTo("%PDF-");

        // 2. Excel export
        ResponseEntity<byte[]> xlsxRes = get("/api/v1/invoices/" + inv.getId() + "/export?format=xlsx", token)
                .retrieve().toEntity(byte[].class);
        assertThat(xlsxRes.getStatusCode().value()).isEqualTo(200);
        assertThat(xlsxRes.getHeaders().getContentType().toString()).contains("spreadsheetml");
        assertThat(xlsxRes.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).contains("invoice-" + inv.getReference() + ".xlsx");
        byte[] xlsxBytes = xlsxRes.getBody();
        assertThat(xlsxBytes).isNotNull().hasSizeGreaterThan(100);
        // ZIP magic bytes PK (0x50, 0x4B)
        assertThat(xlsxBytes[0]).isEqualTo((byte) 0x50);
        assertThat(xlsxBytes[1]).isEqualTo((byte) 0x4B);

        // 3. Word export
        ResponseEntity<byte[]> docRes = get("/api/v1/invoices/" + inv.getId() + "/export?format=doc", token)
                .retrieve().toEntity(byte[].class);
        assertThat(docRes.getStatusCode().value()).isEqualTo(200);
        assertThat(docRes.getHeaders().getContentType().toString()).contains("msword");
        assertThat(docRes.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).contains("invoice-" + inv.getReference() + ".doc");
        String docText = new String(docRes.getBody(), StandardCharsets.UTF_8);
        assertThat(docText).contains("<html").contains("TAX INVOICE").contains(inv.getReference());

        // 4. Bad format returns 400
        ResponseEntity<String> badRes = get("/api/v1/invoices/" + inv.getId() + "/export?format=invalid", token)
                .retrieve().toEntity(String.class);
        assertThat(badRes.getStatusCode().value()).isEqualTo(400);
    }

    @Test
    @DisplayName("portal customer can view invoice details and export, while foreign customer is rejected with 404")
    void portalInvoicePreviewAndExport() {
        Customer customer = customer("Portal Buyer", CustomerTier.SILVER);
        Customer otherCustomer = customer("Other Buyer", CustomerTier.BRONZE);

        Profile buyer = person("buyer-" + suffix(), Role.CUSTOMER, null, customer.getId());
        Profile foreignBuyer = person("other-" + suffix(), Role.CUSTOMER, null, otherCustomer.getId());

        Invoice inv = createTestInvoice(customer.getId());

        // Buyer gets full invoice details
        ResponseEntity<String> detailRes = get("/api/v1/portal/invoices/" + inv.getId(), tokenFor(buyer))
                .retrieve().toEntity(String.class);
        assertThat(detailRes.getStatusCode().value()).isEqualTo(200);
        JsonNode data = json(detailRes.getBody()).get("data");
        assertThat(data.get("reference").asText()).isEqualTo(inv.getReference());
        assertThat(data.get("lines")).hasSize(2);

        // Buyer exports PDF
        ResponseEntity<byte[]> buyerPdf = get("/api/v1/portal/invoices/" + inv.getId() + "/export?format=pdf", tokenFor(buyer))
                .retrieve().toEntity(byte[].class);
        assertThat(buyerPdf.getStatusCode().value()).isEqualTo(200);
        assertThat(buyerPdf.getBody()).startsWith(new byte[]{'%', 'P', 'D', 'F', '-'});

        // Buyer exports Excel
        ResponseEntity<byte[]> buyerXlsx = get("/api/v1/portal/invoices/" + inv.getId() + "/export?format=xlsx", tokenFor(buyer))
                .retrieve().toEntity(byte[].class);
        assertThat(buyerXlsx.getStatusCode().value()).isEqualTo(200);
        assertThat(buyerXlsx.getBody()[0]).isEqualTo((byte) 0x50);
        assertThat(buyerXlsx.getBody()[1]).isEqualTo((byte) 0x4B);

        // Buyer exports Word
        ResponseEntity<byte[]> buyerDoc = get("/api/v1/portal/invoices/" + inv.getId() + "/export?format=doc", tokenFor(buyer))
                .retrieve().toEntity(byte[].class);
        assertThat(buyerDoc.getStatusCode().value()).isEqualTo(200);
        assertThat(new String(buyerDoc.getBody(), StandardCharsets.UTF_8)).contains("TAX INVOICE");

        // Foreign customer isolation: 404
        ResponseEntity<String> foreignRes = get("/api/v1/portal/invoices/" + inv.getId(), tokenFor(foreignBuyer))
                .retrieve().toEntity(String.class);
        assertThat(foreignRes.getStatusCode().value()).isEqualTo(404);

        ResponseEntity<String> foreignExport = get("/api/v1/portal/invoices/" + inv.getId() + "/export?format=pdf", tokenFor(foreignBuyer))
                .retrieve().toEntity(String.class);
        assertThat(foreignExport.getStatusCode().value()).isEqualTo(404);
    }

    private Invoice createTestInvoice(UUID customerId) {
        long seq = System.currentTimeMillis() % 1_000_000L + (long)(Math.random() * 10000);
        String ref = "INV-TEST-" + suffix();
        Invoice inv = new Invoice(seq, ref, customerId, Invoice.InvoiceKind.ONE_TIME, "INR");
        inv.issue(clock.businessToday(), clock.businessToday().plusDays(30));
        inv.addLineTotals(100_000L, 18_000L);
        inv = invoices.save(inv);

        InvoiceLine line1 = new InvoiceLine(inv.getId(), "Enterprise Server License",
                new BigDecimal("1"), 60_000L, 60_000L, 1800, 10_800L);
        line1.setPosition(1);
        line1.setLineType(InvoiceLine.LineType.ONE_TIME);

        InvoiceLine line2 = new InvoiceLine(inv.getId(), "Onboarding & Implementation Support",
                new BigDecimal("1"), 40_000L, 40_000L, 1800, 7_200L);
        line2.setPosition(2);
        line2.setLineType(InvoiceLine.LineType.ONE_TIME);

        invoiceLines.save(line1);
        invoiceLines.save(line2);

        return inv;
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
