package com.dealflow.quotes;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.StringJoiner;

/**
 * A fingerprint of the offer a customer is being asked to accept.
 *
 * <p>Acceptance is recorded against this hash, not against a quotation id. If
 * the rep changed anything after the customer opened the page, the hash no
 * longer matches and the acceptance is refused with a diff — a click on stale
 * terms is never reinterpreted as consent to a price the customer never saw
 * (edge case E19).
 *
 * <p><b>What is in it:</b> everything the customer is agreeing to — currency,
 * order discount, backorder and invoicing terms, activation date, and for each
 * line the item, quantity, unit price, discount, tax rate, cadence and delivery
 * promise.
 *
 * <p><b>What is deliberately not:</b> unit cost. Cost is internal and is not part
 * of the offer; a corrected cost figure changes the margin the reviewer sees, not
 * the deal the customer said yes to. (Submitted revisions are immutable anyway,
 * so a cost correction produces a new revision on its own.)
 *
 * <p>Lines are sorted by key before hashing, so reordering rows in the UI does
 * not invalidate an outstanding acceptance.
 */
public final class CommercialHash {

    private static final String FIELD = "|";
    private static final String RECORD = "\n";

    private CommercialHash() {
    }

    public static String of(QuoteRevision revision, List<QuoteLine> lines) {
        StringJoiner canonical = new StringJoiner(RECORD);
        canonical.add(new StringJoiner(FIELD)
                .add("v1")
                .add(revision.getCurrency())
                .add(Integer.toString(revision.getOrderDiscountBp()))
                .add(revision.getBackorderTerms().name())
                .add(revision.getInvoicingTerms().name())
                .add(nullSafe(revision.getRequestedActivationDate()))
                .toString());

        lines.stream()
                .sorted(Comparator.comparing(QuoteLine::getLineKey))
                .forEach(line -> canonical.add(new StringJoiner(FIELD)
                        .add(line.getLineKey())
                        .add(line.getLineKind().name())
                        .add(nullSafe(line.getVariantId()))
                        .add(nullSafe(line.getPlanId()))
                        .add(normalise(line.getQuantity()))
                        .add(Long.toString(line.getUnitPriceMinor()))
                        .add(Integer.toString(line.getTaxRateBp()))
                        .add(Integer.toString(line.getLineDiscountBp()))
                        .add(Integer.toString(line.getEffectiveDiscountBp()))
                        .add(Long.toString(line.getNetMinor()))
                        .add(nullSafe(line.getIntervalMonths()))
                        .add(nullSafe(line.getPromisedDate()))
                        .toString()));

        return sha256(canonical.toString());
    }

    /** Quantities compare by value, so 10, 10.0 and 10.000 hash identically. */
    private static String normalise(BigDecimal quantity) {
        return quantity == null ? "" : quantity.stripTrailingZeros().toPlainString();
    }

    private static String nullSafe(Object value) {
        return value == null ? "" : value.toString();
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }
}
