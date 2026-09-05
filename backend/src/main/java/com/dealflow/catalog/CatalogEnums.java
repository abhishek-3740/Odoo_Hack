package com.dealflow.catalog;

/** Vocabulary shared across the catalogue. Persisted as uppercase strings. */
public final class CatalogEnums {

    private CatalogEnums() {
    }

    /** Customer pricing tier. Also the first input to the discount ceiling. */
    public enum CustomerTier {
        BRONZE, SILVER, GOLD
    }

    /** Broad category family, used for ceilings and reporting. */
    public enum CategoryKind {
        HARDWARE, SERVICE, SUBSCRIPTION
    }

    /**
     * Whether a line consumes physical inventory. {@code NONE} lines — services
     * and subscription seats — bypass warehouse allocation entirely rather than
     * being allocated a quantity of nothing.
     */
    public enum FulfillmentKind {
        STOCK, NONE
    }

    /** One-off charge versus a recurring plan charge. */
    public enum ChargeKind {
        ONE_TIME, RECURRING
    }

    /** Hardware and seats are whole units; a service may be billed in fractions. */
    public enum QuantityMode {
        INTEGER, DECIMAL
    }

    /**
     * What the billing period is anchored to. {@code ACTIVATION_DATE} gives a
     * full first interval from the start date; {@code CALENDAR_MONTH_START}
     * gives a short, pro-rated first period up to the next calendar boundary.
     */
    public enum BillingAnchor {
        ACTIVATION_DATE, CALENDAR_MONTH_START
    }

    /** Whether a mid-period change is billed now or deferred to the next period. */
    public enum ProrationPolicy {
        IMMEDIATE_PRORATED, NEXT_PERIOD
    }

    /** Whether cancelling stops at period end or refunds unused coverage now. */
    public enum CancellationPolicy {
        END_OF_PERIOD, IMMEDIATE_PRORATED
    }
}
