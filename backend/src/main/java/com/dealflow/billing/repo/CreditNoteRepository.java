package com.dealflow.billing.repo;


import com.dealflow.billing.models.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CreditNoteRepository extends JpaRepository<CreditNote, UUID> {

    Page<CreditNote> findByCustomerId(UUID customerId, Pageable pageable);

    List<CreditNote> findBySubscriptionId(UUID subscriptionId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from CreditNote c where c.id = :id")
    Optional<CreditNote> findByIdForUpdate(@Param("id") UUID id);

    @Query(value = "select nextval('dealflow.credit_note_reference_seq')", nativeQuery = true)
    long nextReferenceNumber();
}
