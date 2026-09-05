package com.dealflow.catalog.repo;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CustomerRepository extends JpaRepository<Customer, UUID> {

    Optional<Customer> findByNameIgnoreCase(String name);

    /**
     * Name search.
     *
     * <p>The pattern is built in Java rather than with {@code concat} around a
     * nullable parameter. A null string parameter reaches PostgreSQL with no
     * type, which makes {@code '%' || ? || '%'} resolve to the {@code bytea}
     * concatenation operator and {@code lower(bytea)} does not exist — so an
     * unfiltered list failed with a 500 rather than returning every row. There
     * is no null in the query at all now.
     */
    @Query("""
            select c from Customer c
             where c.active = true
               and lower(c.name) like :pattern escape '\\'
            """)
    Page<Customer> searchByPattern(@Param("pattern") String pattern, Pageable pageable);

    default Page<Customer> search(String search, Pageable pageable) {
        return searchByPattern(likePattern(search), pageable);
    }

    /**
     * A lower-cased contains pattern; {@code "%"} — match everything — when there
     * is no search term. Wildcards typed by the user are escaped, so searching
     * for "50%" looks for that text rather than matching every row.
     */
    static String likePattern(String search) {
        if (search == null || search.isBlank()) {
            return "%";
        }
        String escaped = search.trim()
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped.toLowerCase(java.util.Locale.ROOT) + "%";
    }
}
