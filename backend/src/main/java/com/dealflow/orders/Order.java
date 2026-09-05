package com.dealflow.orders;

import com.dealflow.quotes.QuoteEnums.BackorderTerms;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/**
 * An executable order, created from exactly one accepted quotation revision.
 *
 * <p>{@code quoteId} is UNIQUE in the database. That one constraint is the real
 * defence against duplicate orders: a triple-clicked acceptance, two approvers
 * finishing at once, a retried request — whichever transaction commits second
 * hits the constraint and rolls back, leaving one order (test T13). The
 * idempotency layer makes that outcome pleasant; the constraint makes it
 * correct.
 */
@jakarta.persistence.Table(name = "orders")
@Entity
public class Order extends TimestampedEntity {

    public enum OrderStatus {
        CONFIRMED, CANCELED
    }

    /**
     * Physical progress, derived from reservations and dispatches rather than
     * set by hand. {@code NOT_REQUIRED} is a services-only order that never
     * touches a warehouse.
     */
    public enum FulfillmentStatus {
        NOT_REQUIRED, UNALLOCATED, PARTIALLY_RESERVED, RESERVED, PARTIALLY_DISPATCHED, DISPATCHED
    }

    public enum BillingStatus {
        PENDING, INITIALIZED
    }

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "quote_id", nullable = false, unique = true, updatable = false)
    private UUID quoteId;

    @Column(name = "revision_id", nullable = false, updatable = false)
    private UUID revisionId;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "owner_profile_id", nullable = false)
    private UUID ownerProfileId;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "order_status", nullable = false)
    private OrderStatus orderStatus = OrderStatus.CONFIRMED;

    @Enumerated(EnumType.STRING)
    @Column(name = "fulfillment_status", nullable = false)
    private FulfillmentStatus fulfillmentStatus = FulfillmentStatus.UNALLOCATED;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_status", nullable = false)
    private BillingStatus billingStatus = BillingStatus.PENDING;

    /** Snapshotted from the accepted revision; shortage handling follows it. */
    @Enumerated(EnumType.STRING)
    @Column(name = "backorder_terms", nullable = false)
    private BackorderTerms backorderTerms = BackorderTerms.ALLOW_BACKORDER;

    @Column(name = "one_time_net_minor", nullable = false)
    private long oneTimeNetMinor;

    @Column(name = "one_time_tax_minor", nullable = false)
    private long oneTimeTaxMinor;

    @Column(name = "confirmed_at", nullable = false)
    private Instant confirmedAt;

    @Column(name = "canceled_at")
    private Instant canceledAt;

    @Version
    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    protected Order() {
    }

    public Order(String reference, UUID quoteId, UUID revisionId, UUID customerId,
                 UUID ownerProfileId, String currency, Instant confirmedAt) {
        this.reference = reference;
        this.quoteId = quoteId;
        this.revisionId = revisionId;
        this.customerId = customerId;
        this.ownerProfileId = ownerProfileId;
        this.currency = currency;
        this.confirmedAt = confirmedAt;
    }

    public String getReference() {
        return reference;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public UUID getRevisionId() {
        return revisionId;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public UUID getOwnerProfileId() {
        return ownerProfileId;
    }

    public String getCurrency() {
        return currency;
    }

    public OrderStatus getOrderStatus() {
        return orderStatus;
    }

    public void setOrderStatus(OrderStatus orderStatus) {
        this.orderStatus = orderStatus;
    }

    public FulfillmentStatus getFulfillmentStatus() {
        return fulfillmentStatus;
    }

    public void setFulfillmentStatus(FulfillmentStatus fulfillmentStatus) {
        this.fulfillmentStatus = fulfillmentStatus;
    }

    public BillingStatus getBillingStatus() {
        return billingStatus;
    }

    public void setBillingStatus(BillingStatus billingStatus) {
        this.billingStatus = billingStatus;
    }

    public BackorderTerms getBackorderTerms() {
        return backorderTerms;
    }

    public void setBackorderTerms(BackorderTerms backorderTerms) {
        this.backorderTerms = backorderTerms;
    }

    public long getOneTimeNetMinor() {
        return oneTimeNetMinor;
    }

    public void setOneTimeNetMinor(long oneTimeNetMinor) {
        this.oneTimeNetMinor = oneTimeNetMinor;
    }

    public long getOneTimeTaxMinor() {
        return oneTimeTaxMinor;
    }

    public void setOneTimeTaxMinor(long oneTimeTaxMinor) {
        this.oneTimeTaxMinor = oneTimeTaxMinor;
    }

    public Instant getConfirmedAt() {
        return confirmedAt;
    }

    public Instant getCanceledAt() {
        return canceledAt;
    }

    public void setCanceledAt(Instant canceledAt) {
        this.canceledAt = canceledAt;
    }

    public long getRowVersion() {
        return rowVersion;
    }
}
