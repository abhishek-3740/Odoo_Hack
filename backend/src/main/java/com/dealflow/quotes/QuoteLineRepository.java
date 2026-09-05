package com.dealflow.quotes;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface QuoteLineRepository extends JpaRepository<QuoteLine, UUID> {

    List<QuoteLine> findByRevisionIdOrderByPositionAsc(UUID revisionId);

    List<QuoteLine> findByRevisionIdIn(Collection<UUID> revisionIds);

    void deleteByRevisionId(UUID revisionId);
}
