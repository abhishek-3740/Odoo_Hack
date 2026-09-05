package com.dealflow.health;

/** Alert vocabulary. */
public final class AlertEnums {

    private AlertEnums() {
    }

    public enum AlertType {
        /** No external progress for the configured duration. */
        STALLED_QUOTE,
        /** Discount far outside this rep's own historical pattern. */
        DISCOUNT_ANOMALY,
        /** Unshipped quantity past its promised date. */
        DELIVERY_SLIPPAGE,
        APPROVAL_OVERDUE,
        /** No qualified, available approver for a pending step. */
        NO_APPROVER,
        LOW_STOCK,
        BACKORDER_OPEN,
        INVOICE_OVERDUE
    }

    public enum Severity {
        INFO, WARNING, CRITICAL
    }

    public enum AlertStatus {
        OPEN, RESOLVED
    }
}
