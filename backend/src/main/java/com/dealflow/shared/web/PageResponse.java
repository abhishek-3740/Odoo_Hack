package com.dealflow.shared.web;

import java.util.List;
import org.springframework.data.domain.Page;

/** Paged list payload. Every list endpoint is bounded; nothing returns "all rows". */
public record PageResponse<T>(List<T> items, int page, int pageSize, long totalItems, int totalPages) {

    public static <T> PageResponse<T> of(Page<T> page) {
        return new PageResponse<>(
                page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }

    /**
     * Maps a page's rows, dropping any the mapper rejects.
     *
     * <p>Several endpoints re-check per-row visibility after the query — a rep
     * only sees approval steps on their own quotations, and only invoices for
     * orders they own — and signal "not yours" by mapping the row to null.
     * Those rows are filtered out here rather than serialised as JSON nulls
     * inside {@code items}, which is not something a client should have to
     * defend against.
     *
     * <p>{@code totalItems} deliberately stays the query's own count: it is what
     * the database matched, and recomputing it from one page would be wrong for
     * every page after the first.
     */
    public static <T, R> PageResponse<R> of(Page<T> page, java.util.function.Function<T, R> mapper) {
        return new PageResponse<>(
                page.getContent().stream().map(mapper).filter(java.util.Objects::nonNull).toList(),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }
}
