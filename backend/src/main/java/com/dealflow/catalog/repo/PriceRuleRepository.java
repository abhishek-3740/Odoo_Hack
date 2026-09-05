package com.dealflow.catalog.repo;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PriceRuleRepository extends JpaRepository<PriceRule, UUID> {

    List<PriceRule> findByVariantId(UUID variantId);

    /**
     * Every candidate rule for a set of variants, fetched in ONE query.
     *
     * <p>Pricing a 30-line quotation must not become 30 round trips. Date and
     * priority filtering happens in {@link PriceResolver} so that an ambiguous
     * configuration can be detected and reported rather than silently resolved.
     */
    @Query("""
            select r from PriceRule r
             where r.variantId in :variantIds
               and r.tier = :tier
               and r.currency = :currency
            """)
    List<PriceRule> findCandidates(@Param("variantIds") Collection<UUID> variantIds,
                                   @Param("tier") CustomerTier tier,
                                   @Param("currency") String currency);
}
