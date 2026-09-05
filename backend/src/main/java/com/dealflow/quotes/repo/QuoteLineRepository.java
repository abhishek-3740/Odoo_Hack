package com.dealflow.quotes.repo;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface QuoteLineRepository extends JpaRepository<QuoteLine, UUID> {

    List<QuoteLine> findByRevisionIdOrderByPositionAsc(UUID revisionId);

    List<QuoteLine> findByRevisionIdIn(Collection<UUID> revisionIds);

    void deleteByRevisionId(UUID revisionId);
}
