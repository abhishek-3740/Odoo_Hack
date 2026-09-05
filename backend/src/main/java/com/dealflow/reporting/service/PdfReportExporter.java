package com.dealflow.reporting.service;


import com.dealflow.reporting.dto.*;
import com.dealflow.reporting.controller.*;
import com.dealflow.reporting.dto.ReportDtos.CategoryRow;
import com.dealflow.reporting.dto.ReportDtos.QuoteRow;
import com.dealflow.reporting.dto.ReportDtos.RepRow;
import com.dealflow.reporting.dto.ReportDtos.SalesReport;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.springframework.stereotype.Component;

/**
 * Renders the sales report as a real PDF with Apache PDFBox.
 *
 * <p>Drawn from the same {@link SalesReport} the screen shows, so the numbers on
 * paper are the numbers on screen. Generation time and currency are printed on
 * the page: a report is a snapshot, and must not be mistaken for live data.
 */
@Component
public class PdfReportExporter {

    private static final float MARGIN = 40f;
    private static final float LINE = 14f;
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ISO_INSTANT;

    public byte[] export(SalesReport report) {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Writer writer = new Writer(document);
            writer.heading("DealFlow360 — Sales report");
            writer.text("Generated " + STAMP.format(report.generatedAt()) + " · Currency " + report.currency()
                    + " · Period " + report.filter().from() + " to " + report.filter().to());
            writer.blank();

            writer.subheading("Headline figures (reported separately, never summed)");
            writer.text("One-time sales:        " + money(report.oneTimeSales(), report.currency()));
            writer.text("Monthly recurring:     " + money(report.monthlyRecurringRevenue(), report.currency())
                    + "  (normalised, not an invoice amount)");
            writer.text("Invoiced revenue:      " + money(report.invoicedRevenue(), report.currency()));
            writer.text("Cash collected:        " + money(report.cashCollected(), report.currency()));
            writer.text("Outstanding:           " + money(report.outstandingReceivables(), report.currency()));
            writer.text("Quotations " + report.quotationCount() + " · Orders " + report.orderCount()
                    + " · Invoices " + report.invoiceCount() + " · Payments " + report.paymentCount());
            writer.blank();

            writer.subheading("Pipeline by stage");
            report.pipeline().forEach(stage -> writer.text(pad(stage.stage(), 22)
                    + pad(Long.toString(stage.count()), 8) + money(stage.oneTimeNet(), report.currency())));
            writer.blank();

            writer.subheading("By sales rep");
            writer.text(pad("Rep", 26) + pad("Quotes", 8) + pad("Orders", 8) + pad("One-time", 16)
                    + pad("MRR", 14) + "Avg disc %");
            for (RepRow row : report.byRep()) {
                writer.text(pad(row.ownerName(), 26) + pad(Long.toString(row.quotations()), 8)
                        + pad(Long.toString(row.orders()), 8)
                        + pad(plain(row.oneTimeSales()), 16) + pad(plain(row.monthlyRecurringRevenue()), 14)
                        + (row.averageDiscountPercent() == null ? "-" : plain(row.averageDiscountPercent())));
            }
            writer.blank();

            writer.subheading("By category");
            writer.text(pad("Category", 18) + pad("One-time", 16) + pad("Recurring", 16)
                    + pad("Contribution", 16) + "Margin %");
            for (CategoryRow row : report.byCategory()) {
                writer.text(pad(row.categoryCode(), 18) + pad(plain(row.oneTimeSales()), 16)
                        + pad(plain(row.recurringFirstCycle()), 16) + pad(plain(row.contribution()), 16)
                        + (row.contributionPercent() == null ? "n/a" : plain(row.contributionPercent())));
            }
            writer.blank();

            writer.subheading("Quotations in period (" + report.quotations().size() + ")");
            writer.text(pad("Reference", 12) + pad("Customer", 22) + pad("Stage", 18)
                    + pad("Approval", 16) + "One-time");
            for (QuoteRow row : report.quotations()) {
                writer.text(pad(row.reference(), 12) + pad(row.customerName(), 22)
                        + pad(row.stage(), 18) + pad(row.approvalStatus(), 16) + plain(row.oneTimeNet()));
            }

            writer.close();
            document.save(out);
            return out.toByteArray();
        } catch (IOException ex) {
            throw new IllegalStateException("Could not render the PDF report", ex);
        }
    }

    /** Minimal paginating text writer over PDFBox content streams. */
    private static final class Writer {
        private final PDDocument document;
        private PDPageContentStream stream;
        private float y;

        Writer(PDDocument document) throws IOException {
            this.document = document;
            newPage();
        }

        private void newPage() throws IOException {
            if (stream != null) {
                stream.close();
            }
            PDPage page = new PDPage(PDRectangle.A4);
            document.addPage(page);
            stream = new PDPageContentStream(document, page);
            y = PDRectangle.A4.getHeight() - MARGIN;
        }

        private void ensureRoom() throws IOException {
            if (y < MARGIN + LINE) {
                newPage();
            }
        }

        void heading(String text) throws IOException {
            ensureRoom();
            write(text, new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD), 16f);
            y -= LINE * 1.6f;
        }

        void subheading(String text) throws IOException {
            ensureRoom();
            write(text, new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD), 11f);
            y -= LINE * 1.2f;
        }

        void text(String text) {
            try {
                ensureRoom();
                write(text, new PDType1Font(Standard14Fonts.FontName.COURIER), 9f);
                y -= LINE;
            } catch (IOException ex) {
                throw new IllegalStateException(ex);
            }
        }

        void blank() {
            y -= LINE * 0.6f;
        }

        private void write(String text, PDType1Font font, float size) throws IOException {
            stream.beginText();
            stream.setFont(font, size);
            stream.newLineAtOffset(MARGIN, y);
            // Standard 14 fonts cover WinAnsi only; anything else is replaced
            // rather than crashing the export.
            stream.showText(text.replaceAll("[^\\x20-\\x7E]", "?"));
            stream.endText();
        }

        void close() throws IOException {
            stream.close();
        }
    }

    private static String money(BigDecimal amount, String currency) {
        return currency + " " + plain(amount);
    }

    private static String plain(BigDecimal amount) {
        return amount == null ? "-" : amount.toPlainString();
    }

    private static String pad(String value, int width) {
        String safe = value == null ? "" : value;
        if (safe.length() >= width) {
            return safe.substring(0, Math.max(0, width - 1)) + " ";
        }
        return safe + " ".repeat(width - safe.length());
    }
}
