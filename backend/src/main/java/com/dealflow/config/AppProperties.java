package com.dealflow.config;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Tunable behaviour, all of it bound from configuration rather than hard-coded.
 *
 * <p>The numeric defaults here are the illustrative commercial policy from the
 * plan, not laws of nature. Discount ceilings and approval thresholds are
 * versioned in the database instead (see {@code dealflow.discount_policies}),
 * because those have to be editable by an administrator at runtime and have to
 * be snapshotted onto each submitted revision.
 */
@ConfigurationProperties(prefix = "dealflow")
@Validated
public record AppProperties(
        @NotNull Auth auth,
        @NotNull Billing billing,
        @NotNull Allocation allocation,
        @NotNull Recommendations recommendations,
        @NotNull Health health,
        @NotNull Jobs jobs,
        @NotNull Demo demo,
        @NotNull Limits limits) {

    /**
     * Identity. Supabase issues the token; this service verifies it and then
     * reads the authoritative role from its own {@code profiles} table.
     *
     * <p>Two verification modes are supported because Supabase supports both:
     * a shared HS256 secret (the local Docker stack's default) and asymmetric
     * keys published as a JWKS (hosted projects with signing keys enabled).
     * Configure exactly one.
     */
    public record Auth(
            String issuerUri,
            String jwkSetUri,
            String jwtSecret,
            @DefaultValue("authenticated") String expectedAudience,
            @DefaultValue("true") boolean requireAudience,
            @DefaultValue("60") long clockSkewSeconds,
            @DefaultValue("http://localhost:3000") List<String> allowedOrigins,
            /* First sign-in for an unknown subject creates a Sales Rep profile.
             * It never creates an approver or a portal identity: those are
             * granted by an administrator. Turn this off to require explicit
             * provisioning for every account. */
            @DefaultValue("true") boolean autoProvisionRep,
            String supabaseUrl,
            String supabaseServiceRoleKey,
            /* Signs tokens for accounts that registered with a password through
             * the storefront. Falls back to the demo secret when unset. */
            String localJwtSecret) {
    }

    public record Billing(
            @DefaultValue("Asia/Kolkata") String timezone,
            @DefaultValue("INR") String defaultCurrency,
            @DefaultValue("15") @Min(0) int invoiceDueDays) {
    }

    /**
     * Warehouse split scoring.
     *
     * <p>{@code BALANCED} charges a penalty for each shipment beyond the first,
     * so one INR 500 remote shipment (score 500) loses to two INR 100 local ones
     * (score 100 + 50 = 150). {@code MIN_SHIPMENTS} and {@code MIN_COST} are the
     * explicit alternatives; none of them is an unspoken rule (edge case E12).
     */
    public record Allocation(
            @DefaultValue("BALANCED") com.dealflow.fulfillment.models.AllocationModel.Mode mode,
            @DefaultValue("5000") @Min(0) long extraShipmentPenaltyMinor,
            @DefaultValue("8") @Min(1) int exhaustiveWarehouseLimit) {
    }

    /**
     * Co-purchase recommendation weights. Statistics come from real finalised
     * order lines; there is no trained model and no hard-coded card.
     */
    public record Recommendations(
            @DefaultValue("0.75") BigDecimal historyWeight,
            @DefaultValue("0.15") BigDecimal promotionWeight,
            @DefaultValue("0.10") BigDecimal marginWeight,
            /* Below this many eligible historical orders the panel reports
             * "limited history" instead of inventing a confidence figure. */
            @DefaultValue("5") @Min(1) int minimumHistoryOrders,
            @DefaultValue("5") @Min(1) int maxResults,
            @DefaultValue("0") BigDecimal minimumCandidateMarginPercent) {
    }

    /**
     * Deal-health thresholds. These describe risk indicators, never predictions
     * and never accusations.
     */
    public record Health(
            @DefaultValue("72") @Min(1) long stalledAfterHours,
            @DefaultValue("48") @Min(1) long approvalDueHours,
            @DefaultValue("12") @Min(1) long nudgeCooldownHours,
            /* Personal discount-anomaly detection stays switched off until the
             * rep has this many finalised quotes. Four observations do not make
             * a mean, and zero is not a baseline (edge case E23). */
            @DefaultValue("5") @Min(2) int anomalyMinimumObservations,
            @DefaultValue("5") BigDecimal anomalyMinimumExcessPp,
            @DefaultValue("2") BigDecimal anomalySigmaMultiplier,
            @DefaultValue("2") BigDecimal anomalyStdDevFloorPp,
            @DefaultValue("7") @Min(1) int lowStockLookaheadDays) {
    }

    public record Jobs(
            @DefaultValue("true") boolean enabled,
            @DefaultValue("25") @Min(1) int billingBatchSize,
            @DefaultValue("50") @Min(1) int outboxBatchSize,
            @DefaultValue("120") @Min(10) long leaseSeconds,
            @DefaultValue("8") @Min(1) int outboxMaxAttempts) {
    }

    /**
     * Demo controls. {@code businessDateOverride} only has any effect when
     * {@code mode} is true, which production deployments leave false: a movable
     * clock is a demo aid, never a way to backdate a real charge.
     */
    public record Demo(
            @DefaultValue("false") boolean mode,
            @DefaultValue("false") boolean seedOnStartup,
            String businessDateOverride,
            /* Kept separate from demo data seeding so Postman users can mint
             * demo identities without changing the application's business clock. */
            @DefaultValue("false") boolean authEnabled,
            String jwtSecret) {
    }

    public record Limits(
            @DefaultValue("100") @Min(1) int maxQuoteLines,
            @DefaultValue("100") @Min(1) int maxPageSize,
            @DefaultValue("1000") @Min(1) int maxExportRows) {
    }
}
