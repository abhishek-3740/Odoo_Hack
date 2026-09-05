package com.dealflow.reporting.dto;


import com.dealflow.reporting.service.*;
import com.dealflow.reporting.controller.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The reporting API surface.
 *
 * <p>Four money figures are reported and never added together, because they
 * answer four different questions:
 * <ul>
 *   <li><b>one-time sales</b> — the value of confirmed one-time lines;</li>
 *   <li><b>MRR</b> — recurring commitments normalised to a month;</li>
 *   <li><b>invoiced</b> — what has actually been billed;</li>
 *   <li><b>collected</b> — what has actually been received.</li>
 * </ul>
 * A dashboard that sums them produces a number that means nothing.
 */
public final class ReportDtos {

    private ReportDtos() {
    }

    /**
     * Filters. Date semantics are fixed and documented: quotations by creation
     * date, orders by confirmation date, invoices by issue date, payments by
     * recorded date.
     */
    public record ReportFilter(
            LocalDate from,
            LocalDate to,
            UUID ownerProfileId,
            UUID teamId,
            UUID customerId,
            String stage,
            UUID categoryId) {
    }

    public record StageCount(String stage, long count, BigDecimal oneTimeNet) {
    }

    public record RepRow(UUID ownerProfileId, String ownerName, long quotations, long orders,
                         BigDecimal oneTimeSales, BigDecimal monthlyRecurringRevenue,
                         BigDecimal averageDiscountPercent) {
    }

    public record CategoryRow(UUID categoryId, String categoryCode, String categoryName,
                              BigDecimal oneTimeSales, BigDecimal recurringFirstCycle,
                              BigDecimal contribution, BigDecimal contributionPercent, long lines) {
    }

    public record ProductRow(UUID productId, String productCode, String productName,
                             BigDecimal quantity, BigDecimal net, long orders) {
    }

    public record QuoteRow(UUID quoteId, String reference, String customerName, String ownerName,
                           String stage, String approvalStatus, String currency,
                           BigDecimal oneTimeNet, BigDecimal recurringFirstCycleNet,
                           BigDecimal contributionPercent, LocalDate createdOn) {
    }

    public record SalesReport(
            ReportFilter filter,
            String currency,
            /** When the figures were computed, so an export cannot pass as live. */
            java.time.Instant generatedAt,
            long quotationCount,
            long orderCount,
            long invoiceCount,
            long paymentCount,
            BigDecimal oneTimeSales,
            BigDecimal monthlyRecurringRevenue,
            BigDecimal invoicedRevenue,
            BigDecimal cashCollected,
            BigDecimal outstandingReceivables,
            List<StageCount> pipeline,
            List<RepRow> byRep,
            List<CategoryRow> byCategory,
            List<ProductRow> topProducts,
            List<QuoteRow> quotations) {
    }
}
