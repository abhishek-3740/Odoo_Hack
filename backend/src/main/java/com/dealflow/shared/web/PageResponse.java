package com.dealflow.shared.web;

import java.util.List;
import org.springframework.data.domain.Page;

/** Paged list payload. Every list endpoint is bounded; nothing returns "all rows". */
public record PageResponse<T>(List<T> items, int page, int pageSize, long totalItems, int totalPages) {

    public static <T> PageResponse<T> of(Page<T> page) {
        return new PageResponse<>(
                page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }

    public static <T, R> PageResponse<R> of(Page<T> page, java.util.function.Function<T, R> mapper) {
        return new PageResponse<>(
                page.getContent().stream().map(mapper).toList(),
                page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
    }
}
