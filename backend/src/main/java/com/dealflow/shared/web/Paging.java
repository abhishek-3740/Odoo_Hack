package com.dealflow.shared.web;

import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import java.util.Set;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;

/**
 * Bounded pagination. No list endpoint returns everything, and the sort field
 * is checked against an allow-list so a caller cannot order by an arbitrary
 * column name.
 */
public final class Paging {

    public static final int MAX_PAGE_SIZE = 100;
    public static final int DEFAULT_PAGE_SIZE = 25;

    private Paging() {
    }

    public static Pageable of(Integer page, Integer pageSize, String sort, Set<String> allowedSorts,
                              String defaultSort) {
        int pageIndex = page == null || page < 0 ? 0 : page;
        int size = pageSize == null || pageSize <= 0 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);

        String field = defaultSort;
        Sort.Direction direction = Sort.Direction.DESC;
        if (sort != null && !sort.isBlank()) {
            String[] parts = sort.split(",", 2);
            field = parts[0].trim();
            if (parts.length > 1 && "asc".equalsIgnoreCase(parts[1].trim())) {
                direction = Sort.Direction.ASC;
            }
            if (!allowedSorts.contains(field)) {
                throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                        "Cannot sort by \"" + field + "\".", "allowed", allowedSorts);
            }
        }
        return PageRequest.of(pageIndex, size, Sort.by(direction, field));
    }
}
