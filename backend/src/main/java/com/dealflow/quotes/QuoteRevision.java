package com.dealflow.quotes;

import com.dealflow.quotes.QuoteEnums.ApprovalStatus;
import com.dealflow.quotes.QuoteEnums.BackorderTerms;
import com.dealflow.quotes.QuoteEnums.InvoicingTerms;
import com.dealflow.quotes.QuoteEnums.RevisionSource;
import com.dealflow.quotes.QuoteEnums.RevisionStatus;
import com.dealflow.quotes.engine.RiskModel.ApprovalLevel;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One immutable version of the commercial terms.
 *
 * <p>Once submitted, nothing here changes. Altering a product, quantity, price,
 * discount, tax, cadence, delivery promise or payment term produces a <em>new</em>
 * revision and clears its acceptance and approval state; the old revision keeps
 * its own decisions as history. That is what makes "the manager approved this"
 * and "the customer accepted this" mean something specific rather than referring
 * to whatever the quotation happens to say now.
 *
 * <p>{@code commercialHash} is the fingerprint of exactly those terms. A customer
 * accepts a hash, not a quotation id; if the rep changed anything since, the
 * acceptance is refused with a diff rather than reinterpreted as consent to a
 * price the customer never saw (edge case E19).
 *
 * <p>{@code policySnapshot} freezes the discount policy the revision was judged
 * against, so editing a ceiling tomorrow cannot retroactively make today's
 * approval unnecessary — or necessary.
 */
@Entity
@Table(name = "quote_revisions")
public class QuoteRevision extends TimestampedEntity {

    @Column(name = "quote_id", nullable = false, updatable = false)
    private UUID quoteId;

    @Column(name = "revision_no", nullable = false, updatable = false)
    private int revisionNo;

    @Enumerated(EnumType.STRING)
    @Column(name = "source", nullable = false)
    private RevisionSource source = RevisionSource.SELLER;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private RevisionStatus status = RevisionStatus.DRAFT;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency = "INR";

    @Column(name = "order_discount_bp", nullable = false)
    private int orderDiscountBp;

    @Column(name = "policy_version_no")
    private Integer policyVersionNo;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "policy_snapshot")
    private String policySnapshot;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "risk_result")
    private String riskResult;

    @Enumerated(EnumType.STRING)
    @Column(name = "approval_status", nullable = false)
    private ApprovalStatus approvalStatus = ApprovalStatus.NOT_EVALUATED;

    @Enumerated(EnumType.STRING)
    @Column(name = "required_level", nullable = false)
    private ApprovalLevel requiredLevel = ApprovalLevel.NONE;

    @Column(name = "commercial_hash")
    private String commercialHash;

    @Column(name = "one_time_net_minor", nullable = false)
    private long oneTimeNetMinor;

    @Column(name = "one_time_tax_minor", nullable = false)
    private long oneTimeTaxMinor;

    @Column(name = "one_time_cost_minor", nullable = false)
    private long oneTimeCostMinor;

    @Column(name = "recurring_first_cycle_net_minor", nullable = false)
    private long recurringFirstCycleNetMinor;

    @Column(name = "recurring_first_cycle_tax_minor", nullable = false)
    private long recurringFirstCycleTaxMinor;

    @Column(name = "recurring_first_cycle_cost_minor", nullable = false)
    private long recurringFirstCycleCostMinor;

    @Column(name = "contribution_minor", nullable = false)
    private long contributionMinor;

    @Column(name = "margin_percent")
    private BigDecimal marginPercent;

    @Column(name = "total_base_minor", nullable = false)
    private long totalBaseMinor;

    @Column(name = "total_discount_minor", nullable = false)
    private long totalDiscountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "backorder_terms", nullable = false)
    private BackorderTerms backorderTerms = BackorderTerms.ALLOW_BACKORDER;

    @Enumerated(EnumType.STRING)
    @Column(name = "invoicing_terms", nullable = false)
    private InvoicingTerms invoicingTerms = InvoicingTerms.ON_CONFIRMATION;

    @Column(name = "requested_activation_date")
    private LocalDate requestedActivationDate;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    /** The seller agreeing to the terms. Required even when the customer proposed them. */
    @Column(name = "seller_adopted_at")
    private Instant sellerAdoptedAt;

    @Column(name = "seller_adopted_by")
    private UUID sellerAdoptedBy;

    @Column(name = "customer_accepted_at")
    private Instant customerAcceptedAt;

    @Column(name = "customer_accepted_by")
    private UUID customerAcceptedBy;

    /** The exact fingerprint the customer agreed to, kept for the audit trail. */
    @Column(name = "customer_accepted_hash")
    private String customerAcceptedHash;

    @Column(name = "created_by_profile_id")
    private UUID createdByProfileId;

    protected QuoteRevision() {
    }

    public QuoteRevision(UUID quoteId, int revisionNo, RevisionSource source, String currency,
                         UUID createdByProfileId) {
        this.quoteId = quoteId;
        this.revisionNo = revisionNo;
        this.source = source;
        this.currency = currency;
        this.createdByProfileId = createdByProfileId;
    }

    /** Both independent gates are clear and this revision may become an order. */
    public boolean clearsAllGates() {
        return status == RevisionStatus.SUBMITTED
                && approvalStatus.clearsApprovalGate()
                && sellerAdoptedAt != null
                && customerAcceptedAt != null;
    }

    public boolean isSubmitted() {
        return status == RevisionStatus.SUBMITTED;
    }

    public void markSubmitted(Instant now) {
        this.status = RevisionStatus.SUBMITTED;
        this.submittedAt = now;
    }

    public void markSuperseded() {
        this.status = RevisionStatus.SUPERSEDED;
    }

    public void recordSellerAdoption(UUID profileId, Instant now) {
        this.sellerAdoptedAt = now;
        this.sellerAdoptedBy = profileId;
    }

    public void recordCustomerAcceptance(UUID profileId, Instant now, String acceptedHash) {
        this.customerAcceptedAt = now;
        this.customerAcceptedBy = profileId;
        this.customerAcceptedHash = acceptedHash;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public int getRevisionNo() {
        return revisionNo;
    }

    public RevisionSource getSource() {
        return source;
    }

    public RevisionStatus getStatus() {
        return status;
    }

    public void setStatus(RevisionStatus status) {
        this.status = status;
    }

    public String getCurrency() {
        return currency;
    }

    public int getOrderDiscountBp() {
        return orderDiscountBp;
    }

    public void setOrderDiscountBp(int orderDiscountBp) {
        this.orderDiscountBp = orderDiscountBp;
    }

    public Integer getPolicyVersionNo() {
        return policyVersionNo;
    }

    public void setPolicyVersionNo(Integer policyVersionNo) {
        this.policyVersionNo = policyVersionNo;
    }

    public String getPolicySnapshot() {
        return policySnapshot;
    }

    public void setPolicySnapshot(String policySnapshot) {
        this.policySnapshot = policySnapshot;
    }

    public String getRiskResult() {
        return riskResult;
    }

    public void setRiskResult(String riskResult) {
        this.riskResult = riskResult;
    }

    public ApprovalStatus getApprovalStatus() {
        return approvalStatus;
    }

    public void setApprovalStatus(ApprovalStatus approvalStatus) {
        this.approvalStatus = approvalStatus;
    }

    public ApprovalLevel getRequiredLevel() {
        return requiredLevel;
    }

    public void setRequiredLevel(ApprovalLevel requiredLevel) {
        this.requiredLevel = requiredLevel;
    }

    public String getCommercialHash() {
        return commercialHash;
    }

    public void setCommercialHash(String commercialHash) {
        this.commercialHash = commercialHash;
    }

    public long getOneTimeNetMinor() {
        return oneTimeNetMinor;
    }

    public long getOneTimeTaxMinor() {
        return oneTimeTaxMinor;
    }

    public long getOneTimeCostMinor() {
        return oneTimeCostMinor;
    }

    public long getRecurringFirstCycleNetMinor() {
        return recurringFirstCycleNetMinor;
    }

    public long getRecurringFirstCycleTaxMinor() {
        return recurringFirstCycleTaxMinor;
    }

    public long getRecurringFirstCycleCostMinor() {
        return recurringFirstCycleCostMinor;
    }

    public long getContributionMinor() {
        return contributionMinor;
    }

    public BigDecimal getMarginPercent() {
        return marginPercent;
    }

    public long getTotalBaseMinor() {
        return totalBaseMinor;
    }

    public long getTotalDiscountMinor() {
        return totalDiscountMinor;
    }

    /** Copies the priced totals onto the revision in one call. */
    public void applyTotals(long oneTimeNet, long oneTimeTax, long oneTimeCost,
                            long recurringNet, long recurringTax, long recurringCost,
                            long contribution, BigDecimal marginPercent,
                            long totalBase, long totalDiscount) {
        this.oneTimeNetMinor = oneTimeNet;
        this.oneTimeTaxMinor = oneTimeTax;
        this.oneTimeCostMinor = oneTimeCost;
        this.recurringFirstCycleNetMinor = recurringNet;
        this.recurringFirstCycleTaxMinor = recurringTax;
        this.recurringFirstCycleCostMinor = recurringCost;
        this.contributionMinor = contribution;
        this.marginPercent = marginPercent;
        this.totalBaseMinor = totalBase;
        this.totalDiscountMinor = totalDiscount;
    }

    public BackorderTerms getBackorderTerms() {
        return backorderTerms;
    }

    public void setBackorderTerms(BackorderTerms backorderTerms) {
        this.backorderTerms = backorderTerms;
    }

    public InvoicingTerms getInvoicingTerms() {
        return invoicingTerms;
    }

    public void setInvoicingTerms(InvoicingTerms invoicingTerms) {
        this.invoicingTerms = invoicingTerms;
    }

    public LocalDate getRequestedActivationDate() {
        return requestedActivationDate;
    }

    public void setRequestedActivationDate(LocalDate requestedActivationDate) {
        this.requestedActivationDate = requestedActivationDate;
    }

    public Instant getSubmittedAt() {
        return submittedAt;
    }

    public Instant getSellerAdoptedAt() {
        return sellerAdoptedAt;
    }

    public UUID getSellerAdoptedBy() {
        return sellerAdoptedBy;
    }

    public Instant getCustomerAcceptedAt() {
        return customerAcceptedAt;
    }

    public UUID getCustomerAcceptedBy() {
        return customerAcceptedBy;
    }

    public String getCustomerAcceptedHash() {
        return customerAcceptedHash;
    }

    public UUID getCreatedByProfileId() {
        return createdByProfileId;
    }
}
