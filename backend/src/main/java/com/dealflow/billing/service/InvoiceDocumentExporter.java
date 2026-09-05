package com.dealflow.billing.service;

import com.dealflow.billing.dto.BillingDtos.InvoiceLineResponse;
import com.dealflow.billing.dto.BillingDtos.InvoiceResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.format.DateTimeFormatter;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

/**
 * Multi-format invoice document exporter supporting PDF, Excel (XLSX), and Word (DOC).
 */
@Component
public class InvoiceDocumentExporter {

    private static final float MARGIN = 40f;
    private static final float LINE = 14f;
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ISO_LOCAL_DATE;

    // ------------------------------------------------------------- PDF Export

    public byte[] exportPdf(InvoiceResponse invoice) {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PdfWriter writer = new PdfWriter(document);

            // Corporate Header
            writer.heading("DealFlow360 Enterprise Deals Inc.");
            writer.text("Cyber Gateway, Technology Boulevard, Bengaluru, KA 560066 | GSTIN: 29AABCB1234F1Z5");
            writer.text("Tax Invoice / Commercial Settlement Statement");
            writer.blank();

            // Invoice Summary Block
            writer.subheading("Invoice Reference: " + invoice.reference() + "  [" + invoice.status() + "]");
            writer.text("Issue Date:      " + (invoice.issueDate() != null ? invoice.issueDate().toString() : "N/A"));
            writer.text("Due Date:        " + (invoice.dueDate() != null ? invoice.dueDate().toString() : "N/A"));
            writer.text("Currency:        " + invoice.currency() + " (" + invoice.invoiceKind() + ")");
            writer.text("Customer:        " + (invoice.customerName() != null ? invoice.customerName() : "Account #" + invoice.customerId()));
            if (invoice.orderId() != null) {
                writer.text("Order ID:        " + invoice.orderId());
            }
            if (invoice.subscriptionId() != null) {
                writer.text("Subscription ID: " + invoice.subscriptionId());
            }
            writer.blank();

            // Line Items Table
            writer.subheading("Itemized Charges");
            writer.text(pad("Item Description", 38) + pad("Qty", 6) + pad("Rate", 12) + pad("Tax", 10) + pad("Net Amount", 14));
            writer.text("-".repeat(80));

            if (invoice.lines() != null && !invoice.lines().isEmpty()) {
                for (InvoiceLineResponse line : invoice.lines()) {
                    String desc = line.description() != null ? line.description() : "Charge line";
                    if (desc.length() > 36) {
                        desc = desc.substring(0, 33) + "...";
                    }
                    String qty = line.quantity() != null ? line.quantity().toPlainString() : "1";
                    String rate = formatMoney(line.unitPrice(), invoice.currency());
                    String tax = formatMoney(line.tax(), invoice.currency());
                    String net = formatMoney(line.net(), invoice.currency());
                    writer.text(pad(desc, 38) + pad(qty, 6) + pad(rate, 12) + pad(tax, 10) + pad(net, 14));
                }
            } else {
                writer.text("No itemized lines recorded.");
            }
            writer.text("-".repeat(80));
            writer.blank();

            // Financial Summary Block
            writer.subheading("Financial Reconciliation");
            writer.text("Subtotal Net:       " + formatMoney(invoice.net(), invoice.currency()));
            writer.text("Taxes (GST/VAT):    " + formatMoney(invoice.tax(), invoice.currency()));
            writer.text("Total Invoice:      " + formatMoney(invoice.total(), invoice.currency()));
            writer.text("Credits Applied:    " + formatMoney(invoice.credited(), invoice.currency()));
            writer.text("Paid Amount:        " + formatMoney(invoice.paid(), invoice.currency()));
            writer.text("Balance Due:        " + formatMoney(invoice.outstanding(), invoice.currency()));
            writer.blank();

            // Remittance & Wire Instructions
            writer.subheading("Wire Remittance & Settlement Instructions");
            writer.text("Bank Name:       HDFC Bank Corporate Banking");
            writer.text("Account Number:  50200098765432");
            writer.text("IFSC / Code:     HDFC0000123");
            writer.text("SWIFT Code:      HDFCINBBXXX");
            writer.text("Payment Note:    Quote invoice ref " + invoice.reference() + " in wire transfer description.");
            writer.blank();
            writer.text("Thank you for your business. For billing queries: billing@dealflow.corp");

            writer.close();
            document.save(out);
            return out.toByteArray();
        } catch (IOException ex) {
            throw new IllegalStateException("Failed to render invoice PDF: " + ex.getMessage(), ex);
        }
    }

    // ----------------------------------------------------------- Excel Export

    public byte[] exportExcel(InvoiceResponse invoice) {
        try (Workbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = workbook.createSheet("Invoice " + invoice.reference());

            // Styles
            Font titleFont = workbook.createFont();
            titleFont.setBold(true);
            titleFont.setFontHeightInPoints((short) 14);
            CellStyle titleStyle = workbook.createCellStyle();
            titleStyle.setFont(titleFont);

            Font boldFont = workbook.createFont();
            boldFont.setBold(true);

            CellStyle headerStyle = workbook.createCellStyle();
            headerStyle.setFont(boldFont);
            headerStyle.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
            headerStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            headerStyle.setBorderBottom(BorderStyle.THIN);

            CellStyle boldStyle = workbook.createCellStyle();
            boldStyle.setFont(boldFont);

            CellStyle moneyStyle = workbook.createCellStyle();
            moneyStyle.setDataFormat(workbook.createDataFormat().getFormat("#,##0.00"));

            CellStyle boldMoneyStyle = workbook.createCellStyle();
            boldMoneyStyle.setFont(boldFont);
            boldMoneyStyle.setDataFormat(workbook.createDataFormat().getFormat("#,##0.00"));

            int rowIdx = 0;

            // Title
            Row titleRow = sheet.createRow(rowIdx++);
            Cell titleCell = titleRow.createCell(0);
            titleCell.setCellValue("DealFlow360 — Tax Invoice " + invoice.reference());
            titleCell.setCellStyle(titleStyle);
            rowIdx++; // Blank row

            // Metadata
            addMetaRow(sheet, rowIdx++, "Invoice Reference", invoice.reference(), boldStyle);
            addMetaRow(sheet, rowIdx++, "Status", invoice.status(), boldStyle);
            addMetaRow(sheet, rowIdx++, "Customer", invoice.customerName() != null ? invoice.customerName() : invoice.customerId().toString(), boldStyle);
            addMetaRow(sheet, rowIdx++, "Issue Date", invoice.issueDate() != null ? invoice.issueDate().toString() : "", boldStyle);
            addMetaRow(sheet, rowIdx++, "Due Date", invoice.dueDate() != null ? invoice.dueDate().toString() : "", boldStyle);
            addMetaRow(sheet, rowIdx++, "Currency", invoice.currency(), boldStyle);
            rowIdx++; // Blank row

            // Line items header
            Row lineHeader = sheet.createRow(rowIdx++);
            String[] headers = new String[]{"#", "Description", "Type", "Coverage Start", "Coverage End", "Qty", "Unit Rate (" + invoice.currency() + ")", "Tax (" + invoice.currency() + ")", "Net Amount (" + invoice.currency() + ")"};
            for (int i = 0; i < headers.length; i++) {
                Cell cell = lineHeader.createCell(i);
                cell.setCellValue(headers[i]);
                cell.setCellStyle(headerStyle);
            }

            // Line items rows
            int lineNum = 1;
            if (invoice.lines() != null) {
                for (InvoiceLineResponse line : invoice.lines()) {
                    Row r = sheet.createRow(rowIdx++);
                    r.createCell(0).setCellValue(lineNum++);
                    r.createCell(1).setCellValue(line.description() != null ? line.description() : "");
                    r.createCell(2).setCellValue(line.lineType() != null ? line.lineType() : "");
                    r.createCell(3).setCellValue(line.coverageStart() != null ? line.coverageStart().toString() : "");
                    r.createCell(4).setCellValue(line.coverageEnd() != null ? line.coverageEnd().toString() : "");
                    
                    Cell qtyCell = r.createCell(5);
                    if (line.quantity() != null) qtyCell.setCellValue(line.quantity().doubleValue());

                    Cell rateCell = r.createCell(6);
                    if (line.unitPrice() != null) {
                        rateCell.setCellValue(line.unitPrice().doubleValue());
                        rateCell.setCellStyle(moneyStyle);
                    }

                    Cell taxCell = r.createCell(7);
                    if (line.tax() != null) {
                        taxCell.setCellValue(line.tax().doubleValue());
                        taxCell.setCellStyle(moneyStyle);
                    }

                    Cell netCell = r.createCell(8);
                    if (line.net() != null) {
                        netCell.setCellValue(line.net().doubleValue());
                        netCell.setCellStyle(moneyStyle);
                    }
                }
            }
            rowIdx++; // Blank row

            // Totals
            addTotalRow(sheet, rowIdx++, "Subtotal Net:", invoice.net(), boldStyle, moneyStyle);
            addTotalRow(sheet, rowIdx++, "Taxes (GST/VAT):", invoice.tax(), boldStyle, moneyStyle);
            addTotalRow(sheet, rowIdx++, "Total Invoice Amount:", invoice.total(), boldStyle, boldMoneyStyle);
            addTotalRow(sheet, rowIdx++, "Credits Applied:", invoice.credited(), boldStyle, moneyStyle);
            addTotalRow(sheet, rowIdx++, "Amount Paid:", invoice.paid(), boldStyle, moneyStyle);
            addTotalRow(sheet, rowIdx++, "Balance Due / Outstanding:", invoice.outstanding(), boldStyle, boldMoneyStyle);
            rowIdx++;

            // Wire instructions
            addMetaRow(sheet, rowIdx++, "Wire Instructions", "HDFC Bank Corp | A/C: 50200098765432 | IFSC: HDFC0000123", boldStyle);
            addMetaRow(sheet, rowIdx++, "Payment Reference", "Please cite invoice reference " + invoice.reference(), boldStyle);

            // Auto-size columns
            for (int i = 0; i < headers.length; i++) {
                sheet.autoSizeColumn(i);
            }

            workbook.write(out);
            return out.toByteArray();
        } catch (IOException ex) {
            throw new IllegalStateException("Failed to render invoice Excel: " + ex.getMessage(), ex);
        }
    }

    // ------------------------------------------------------------ Word Export

    public byte[] exportDoc(InvoiceResponse invoice) {
        StringBuilder sb = new StringBuilder();
        sb.append("<html xmlns:o='urn:schemas-microsoft-com:office:office' ");
        sb.append("xmlns:w='urn:schemas-microsoft-com:office:word' ");
        sb.append("xmlns='http://www.w3.org/TR/REC-html40'>\n");
        sb.append("<head><meta charset='utf-8'><title>Invoice ").append(invoice.reference()).append("</title>\n");
        sb.append("<style>\n");
        sb.append("body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #1e293b; margin: 30px; }\n");
        sb.append("h1 { font-size: 18pt; color: #0f172a; margin-bottom: 4px; }\n");
        sb.append(".subtitle { font-size: 9pt; color: #64748b; margin-bottom: 20px; }\n");
        sb.append("table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 15px; }\n");
        sb.append("th, td { padding: 8px 10px; text-align: left; font-size: 9pt; border-bottom: 1px solid #e2e8f0; }\n");
        sb.append("th { background-color: #f8fafc; font-weight: bold; color: #475569; border-top: 1px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; }\n");
        sb.append(".text-right { text-align: right; }\n");
        sb.append(".badge { display: inline-block; padding: 2px 8px; font-weight: bold; font-size: 8pt; border-radius: 4px; background: #e0e7ff; color: #4338ca; }\n");
        sb.append(".totals-table { width: 340px; margin-left: auto; }\n");
        sb.append(".bold { font-weight: bold; }\n");
        sb.append(".highlight { background-color: #f1f5f9; font-size: 11pt; color: #0f172a; }\n");
        sb.append(".footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #cbd5e1; font-size: 8pt; color: #64748b; }\n");
        sb.append("</style></head><body>\n");

        sb.append("<h1>DealFlow360 Enterprise Deals Inc.</h1>\n");
        sb.append("<div class='subtitle'>Cyber Gateway, Bengaluru, KA 560066 | GSTIN: 29AABCB1234F1Z5 | billing@dealflow.corp</div>\n");

        sb.append("<table>\n");
        sb.append("<tr>");
        sb.append("<td style='width:50%; vertical-align:top;'>");
        sb.append("<strong>Billed To:</strong><br/>");
        sb.append(invoice.customerName() != null ? invoice.customerName() : "Customer #" + invoice.customerId()).append("<br/>");
        if (invoice.orderId() != null) sb.append("Order: ").append(invoice.orderId()).append("<br/>");
        if (invoice.subscriptionId() != null) sb.append("Subscription: ").append(invoice.subscriptionId()).append("<br/>");
        sb.append("</td>");
        sb.append("<td style='width:50%; vertical-align:top; text-align:right;'>");
        sb.append("<span style='font-size:14pt; font-weight:bold;'>TAX INVOICE ").append(invoice.reference()).append("</span><br/>");
        sb.append("Status: <span class='badge'>").append(invoice.status()).append("</span><br/>");
        sb.append("Issue Date: ").append(invoice.issueDate() != null ? invoice.issueDate().toString() : "N/A").append("<br/>");
        sb.append("Due Date: ").append(invoice.dueDate() != null ? invoice.dueDate().toString() : "N/A").append("<br/>");
        sb.append("Currency: ").append(invoice.currency()).append("<br/>");
        sb.append("</td>");
        sb.append("</tr>\n");
        sb.append("</table>\n");

        sb.append("<table>\n");
        sb.append("<thead><tr>\n");
        sb.append("<th>Description</th><th>Type</th><th class='text-right'>Qty</th><th class='text-right'>Unit Rate</th><th class='text-right'>Tax</th><th class='text-right'>Net Total</th>\n");
        sb.append("</tr></thead><tbody>\n");

        if (invoice.lines() != null && !invoice.lines().isEmpty()) {
            for (InvoiceLineResponse line : invoice.lines()) {
                sb.append("<tr>\n");
                sb.append("<td><strong>").append(escape(line.description())).append("</strong></td>\n");
                sb.append("<td>").append(escape(line.lineType())).append("</td>\n");
                sb.append("<td class='text-right'>").append(line.quantity() != null ? line.quantity().toPlainString() : "1").append("</td>\n");
                sb.append("<td class='text-right'>").append(formatMoney(line.unitPrice(), invoice.currency())).append("</td>\n");
                sb.append("<td class='text-right'>").append(formatMoney(line.tax(), invoice.currency())).append("</td>\n");
                sb.append("<td class='text-right'><strong>").append(formatMoney(line.net(), invoice.currency())).append("</strong></td>\n");
                sb.append("</tr>\n");
            }
        }
        sb.append("</tbody></table>\n");

        sb.append("<table class='totals-table'>\n");
        sb.append("<tr><td>Subtotal Net:</td><td class='text-right'>").append(formatMoney(invoice.net(), invoice.currency())).append("</td></tr>\n");
        sb.append("<tr><td>Tax (GST/VAT):</td><td class='text-right'>").append(formatMoney(invoice.tax(), invoice.currency())).append("</td></tr>\n");
        sb.append("<tr class='bold'><td>Total Invoice Amount:</td><td class='text-right'>").append(formatMoney(invoice.total(), invoice.currency())).append("</td></tr>\n");
        sb.append("<tr><td>Credits Applied:</td><td class='text-right'>").append(formatMoney(invoice.credited(), invoice.currency())).append("</td></tr>\n");
        sb.append("<tr><td>Paid Amount:</td><td class='text-right'>").append(formatMoney(invoice.paid(), invoice.currency())).append("</td></tr>\n");
        sb.append("<tr class='highlight bold'><td>Balance Due / Outstanding:</td><td class='text-right'>").append(formatMoney(invoice.outstanding(), invoice.currency())).append("</td></tr>\n");
        sb.append("</table>\n");

        sb.append("<div class='footer'>\n");
        sb.append("<strong>Wire Remittance Instructions:</strong> HDFC Bank Corp | A/C: 50200098765432 | IFSC: HDFC0000123 | SWIFT: HDFCINBBXXX<br/>");
        sb.append("Please quote reference <strong>").append(invoice.reference()).append("</strong> on all wire remittances.<br/>");
        sb.append("This is a computer-generated tax invoice and requires no physical signature.\n");
        sb.append("</div></body></html>");

        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    // ---------------------------------------------------------------- Helpers

    private static void addMetaRow(Sheet sheet, int rowIdx, String label, String val, CellStyle bold) {
        Row r = sheet.createRow(rowIdx);
        Cell c0 = r.createCell(0);
        c0.setCellValue(label);
        c0.setCellStyle(bold);
        r.createCell(1).setCellValue(val != null ? val : "");
    }

    private static void addTotalRow(Sheet sheet, int rowIdx, String label, BigDecimal amount, CellStyle labelStyle, CellStyle amountStyle) {
        Row r = sheet.createRow(rowIdx);
        Cell c6 = r.createCell(6);
        c6.setCellValue(label);
        c6.setCellStyle(labelStyle);

        Cell c8 = r.createCell(8);
        if (amount != null) {
            c8.setCellValue(amount.doubleValue());
            c8.setCellStyle(amountStyle);
        }
    }

    private static String formatMoney(BigDecimal amount, String currency) {
        if (amount == null) return "0.00 " + currency;
        return amount.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString() + " " + currency;
    }

    private static String pad(String str, int length) {
        if (str == null) str = "";
        if (str.length() >= length) return str.substring(0, length);
        return str + " ".repeat(length - str.length());
    }

    private static String escape(String input) {
        if (input == null) return "";
        return input.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static final class PdfWriter {
        private final PDDocument document;
        private PDPageContentStream stream;
        private float y;

        PdfWriter(PDDocument document) throws IOException {
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
            write(text, new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD), 14f);
            y -= LINE * 1.5f;
        }

        void subheading(String text) throws IOException {
            ensureRoom();
            write(text, new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD), 10f);
            y -= LINE * 1.2f;
        }

        void text(String text) {
            try {
                ensureRoom();
                write(text, new PDType1Font(Standard14Fonts.FontName.COURIER), 8.5f);
                y -= LINE;
            } catch (IOException ex) {
                throw new IllegalStateException(ex);
            }
        }

        void blank() {
            y -= LINE * 0.5f;
        }

        private void write(String text, PDType1Font font, float size) throws IOException {
            stream.beginText();
            stream.setFont(font, size);
            stream.newLineAtOffset(MARGIN, y);
            stream.showText(text.replaceAll("[^\\x20-\\x7E]", " "));
            stream.endText();
        }

        void close() throws IOException {
            if (stream != null) {
                stream.close();
            }
        }
    }
}
