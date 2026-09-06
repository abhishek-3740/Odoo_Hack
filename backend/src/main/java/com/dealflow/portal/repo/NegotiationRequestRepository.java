package com.dealflow.portal.repo;


import com.dealflow.portal.models.*;
import com.dealflow.portal.service.*;
import com.dealflow.portal.dto.*;
import com.dealflow.portal.controller.*;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NegotiationRequestRepository extends JpaRepository<NegotiationRequest, UUID> {

    List<NegotiationRequest> findByQuoteIdOrderByCreatedAtDesc(UUID quoteId);

    /** Every request that proposed one particular candidate revision. */
    List<NegotiationRequest> findByCandidateRevisionId(UUID candidateRevisionId);

    @Query("""
            select n from NegotiationRequest n
             where n.quoteId = :quoteId
               and n.status = com.dealflow.quotes.models.QuoteEnums.NegotiationStatus.OPEN
             order by n.createdAt desc
            """)
    List<NegotiationRequest> findOpenForQuote(@Param("quoteId") UUID quoteId);

    @Query("""
            select n from NegotiationRequest n
             where n.candidateRevisionId is not null
               and n.quoteId = :quoteId
               and n.status = com.dealflow.quotes.models.QuoteEnums.NegotiationStatus.OPEN
             order by n.createdAt desc
            """)
    List<NegotiationRequest> findOpenCandidates(@Param("quoteId") UUID quoteId);
}
