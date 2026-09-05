package com.dealflow.catalog;

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

    @Query("""
            select p from Product p
             where p.active = true
               and (:categoryId is null or p.categoryId = :categoryId)
               and (:search is null or lower(p.name) like lower(concat('%', :search, '%'))
                    or lower(p.code) like lower(concat('%', :search, '%')))
            """)
    Page<Product> search(@Param("categoryId") UUID categoryId,
                         @Param("search") String search,
                         Pageable pageable);
}
