package com.dealflow.billing;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefundRepository extends JpaRepository<Refund, UUID> {

    Page<Refund> findByCustomerId(UUID customerId, Pageable pageable);

    List<Refund> findByCreditNoteId(UUID creditNoteId);

    /** Total already refunded to a customer, so a refund can never exceed receipts. */
    @Query("select coalesce(sum(r.amountMinor), 0) from Refund r where r.customerId = :customerId")
    long sumRefundedTo(@Param("customerId") UUID customerId);

    @Query(value = "select nextval('dealflow.refund_reference_seq')", nativeQuery = true)
    long nextReferenceNumber();
}
