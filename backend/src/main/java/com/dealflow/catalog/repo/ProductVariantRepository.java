package com.dealflow.catalog.repo;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductVariantRepository extends JpaRepository<ProductVariant, UUID> {

    Optional<ProductVariant> findBySku(String sku);

    List<ProductVariant> findByProductIdAndActiveTrueOrderByNameAsc(UUID productId);

    List<ProductVariant> findByIdIn(Collection<UUID> ids);

    /** Catalogue-configured equivalents, used only for explicit substitution. */
    @Query("""
            select v from ProductVariant v
             where v.substitutionGroup = :group
               and v.active = true
               and v.id <> :excludeId
            """)
    List<ProductVariant> findSubstitutes(@Param("group") String group, @Param("excludeId") UUID excludeId);
}
