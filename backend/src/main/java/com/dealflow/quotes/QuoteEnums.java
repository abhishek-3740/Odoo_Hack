package com.dealflow.quotes;

/** Quotation vocabulary. Persisted as uppercase strings. */
public final class QuoteEnums {

    private QuoteEnums() {
    }

    /**
     * The visible sales stage.
     *
     * <p>Stage alone never authorises execution. Approval and customer
     * acceptance are independent facts recorded on the revision; an order is
     * created only when every gate holds, whatever the stage label says.
     */
    public enum Stage {
        DRAFT, REVIEW, SENT, UNDER_NEGOTIATION, CONFIRMED, CANCELED, LOST, EXPIRED;

        public boolean isTerminal() {
            return this == CONFIRMED || this == CANCELED || this == LOST || this == EXPIRED;
        }

        /** Whether commercial terms may still be edited or negotiated. */
        public boolean isOpen() {
            return !isTerminal();
        }
    }

    public enum RevisionStatus {
        DRAFT, SUBMITTED, SUPERSEDED, CANCELED
    }

    /** Who proposed this version of the terms. */
    public enum RevisionSource {
        SELLER, CUSTOMER_COUNTER, SYSTEM
    }

    /**
     * Approval state of one revision.
     *
     * <p>{@code NOT_EVALUATED} means the revision is still a draft. Everything
     * else is set by the risk engine at submission and moved only by a recorded
     * approver decision.
     */
    public enum ApprovalStatus {
        NOT_EVALUATED, NOT_REQUIRED, PENDING_MANAGER, PENDING_FINANCE,
        APPROVED, REJECTED, REVISION_REQUIRED;

        /** Whether this state permits creating an order. */
        public boolean clearsApprovalGate() {
            return this == NOT_REQUIRED || this == APPROVED;
        }

        public boolean isPending() {
            return this == PENDING_MANAGER || this == PENDING_FINANCE;
        }
    }

    /** How the customer agreed shortages should be handled. Part of accepted terms. */
    public enum BackorderTerms {
        ALLOW_BACKORDER, IN_STOCK_ONLY
    }

    /**
     * When one-time lines are invoiced. Disclosed alongside backorder terms,
     * because issuing an invoice before shipment is a commercial decision the
     * customer accepts rather than a silent default.
     */
    public enum InvoicingTerms {
        ON_CONFIRMATION
    }

    public enum ApprovalRequestStatus {
        PENDING, APPROVED, REJECTED, REVISION_REQUIRED, SUPERSEDED
    }

    public enum NegotiationType {
        COMMENT, CHANGE, COUNTER
    }

    public enum NegotiationStatus {
        OPEN, ANSWERED, ADOPTED, DECLINED, SUPERSEDED
    }

    public enum LineSource {
        MANUAL, RECOMMENDATION, COUNTER, SCENARIO
    }
}
