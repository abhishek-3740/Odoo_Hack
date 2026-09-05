package com.dealflow.catalog.repo;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductRepository extends JpaRepository<Product, UUID> {

    Optional<Product> findByCode(String code);

    List<Product> findByCategoryIdAndActiveTrue(UUID categoryId);

    /**
     * Catalog search by name or code — the query behind the quote builder's
     * product picker.
     *
     * <p>The pattern is built in Java rather than with {@code concat} around a
     * nullable parameter. A null string parameter reaches PostgreSQL with no
     * type, which makes {@code '%' || ? || '%'} resolve to the {@code bytea}
     * concatenation operator and {@code lower(bytea)} does not exist — so
     * browsing the catalog with an empty search box failed with a 500 instead
     * of listing everything. There is no null in the query at all now.
     */
    @Query("""
            select p from Product p
             where p.active = true
               and (:categoryId is null or p.categoryId = :categoryId)
               and (lower(p.name) like :pattern escape '\\'
                    or lower(p.code) like :pattern escape '\\')
            """)
    Page<Product> searchByPattern(@Param("categoryId") UUID categoryId,
                                  @Param("pattern") String pattern,
                                  Pageable pageable);

    default Page<Product> search(UUID categoryId, String search, Pageable pageable) {
        return searchByPattern(categoryId, CustomerRepository.likePattern(search), pageable);
    }
}
