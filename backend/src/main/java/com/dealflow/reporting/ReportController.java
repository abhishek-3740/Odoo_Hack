package com.dealflow.reporting;

import com.dealflow.auth.Actor;
import com.dealflow.reporting.dto.ReportDtos.ReportFilter;
import com.dealflow.reporting.dto.ReportDtos.SalesReport;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.web.ApiResponse;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Sales reporting and exports.
 *
 * <p>The export endpoint calls the exact same service method as the JSON one,
 * with the exact same role scoping. The file is the screen, rendered.
 */
@RestController
@RequestMapping("/api/v1/reports")
public class ReportController {

    private final ReportService reportService;
    private final PdfReportExporter pdfExporter;
    private final SpreadsheetReportExporter spreadsheetExporter;

    public ReportController(ReportService reportService, PdfReportExporter pdfExporter,
                            SpreadsheetReportExporter spreadsheetExporter) {
        this.reportService = reportService;
        this.pdfExporter = pdfExporter;
        this.spreadsheetExporter = spreadsheetExporter;
    }

    @GetMapping("/sales")
    public ApiResponse<SalesReport> sales(@RequestParam(required = false) LocalDate from,
                                          @RequestParam(required = false) LocalDate to,
                                          @RequestParam(required = false) UUID ownerProfileId,
                                          @RequestParam(required = false) UUID teamId,
                                          @RequestParam(required = false) UUID customerId,
                                          @RequestParam(required = false) String stage,
                                          @RequestParam(required = false) UUID categoryId,
                                          Actor actor) {
        return ApiResponse.of(reportService.salesReport(
                new ReportFilter(from, to, ownerProfileId, teamId, customerId, stage, categoryId), actor));
    }

    /** {@code format} is {@code pdf}, {@code xlsx} or {@code xls}; each is a genuine file of that type. */
    @GetMapping("/sales/export")
    public ResponseEntity<byte[]> export(@RequestParam String format,
                                         @RequestParam(required = false) LocalDate from,
                                         @RequestParam(required = false) LocalDate to,
                                         @RequestParam(required = false) UUID ownerProfileId,
                                         @RequestParam(required = false) UUID teamId,
                                         @RequestParam(required = false) UUID customerId,
                                         @RequestParam(required = false) String stage,
                                         @RequestParam(required = false) UUID categoryId,
                                         Actor actor) {
        SalesReport report = reportService.salesReport(
                new ReportFilter(from, to, ownerProfileId, teamId, customerId, stage, categoryId), actor);
        String stamp = report.generatedAt().toString().replaceAll("[^0-9]", "").substring(0, 14);

        byte[] body;
        String mediaType;
        String extension;
        switch (format.toLowerCase(java.util.Locale.ROOT)) {
            case "pdf" -> {
                body = pdfExporter.export(report);
                mediaType = MediaType.APPLICATION_PDF_VALUE;
                extension = "pdf";
            }
            case "xlsx" -> {
                body = spreadsheetExporter.export(report, SpreadsheetReportExporter.Format.XLSX);
                mediaType = SpreadsheetReportExporter.Format.XLSX.mediaType();
                extension = SpreadsheetReportExporter.Format.XLSX.extension();
            }
            case "xls" -> {
                body = spreadsheetExporter.export(report, SpreadsheetReportExporter.Format.XLS);
                mediaType = SpreadsheetReportExporter.Format.XLS.mediaType();
                extension = SpreadsheetReportExporter.Format.XLS.extension();
            }
            default -> throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "format must be pdf, xlsx or xls.");
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"dealflow-sales-" + stamp + "." + extension + "\"")
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(MediaType.parseMediaType(mediaType))
                .body(body);
    }
}
