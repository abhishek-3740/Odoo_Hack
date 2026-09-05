package com.dealflow.quotes.repo;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.quotes.models.QuoteEnums.RevisionStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface QuoteRevisionRepository extends JpaRepository<QuoteRevision, UUID> {

    List<QuoteRevision> findByQuoteIdOrderByRevisionNoDesc(UUID quoteId);

    Optional<QuoteRevision> findByQuoteIdAndRevisionNo(UUID quoteId, int revisionNo);

    List<QuoteRevision> findByQuoteIdAndStatus(UUID quoteId, RevisionStatus status);

    /**
     * Effective discount percentage of each finalised quotation for one rep.
     *
     * <p>The baseline for personal anomaly detection. It excludes the quotation
     * being judged, so a deal never contributes to the statistics it is being
     * compared against, and it reads only the revision that actually became the
     * order rather than every draft along the way.
     */
    @Query("""
            select (r.totalDiscountMinor * 100.0 / r.totalBaseMinor)
              from QuoteRevision r, Quote q
             where q.id = r.quoteId
               and q.ownerProfileId = :ownerProfileId
               and q.stage = com.dealflow.quotes.models.QuoteEnums.Stage.CONFIRMED
               and r.id = q.currentRevisionId
               and r.totalBaseMinor > 0
               and q.id <> :excludeQuoteId
            """)
    List<Double> findHistoricalDiscountPercents(@Param("ownerProfileId") UUID ownerProfileId,
                                                @Param("excludeQuoteId") UUID excludeQuoteId);
}
