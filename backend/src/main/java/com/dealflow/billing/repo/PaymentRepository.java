package com.dealflow.billing.repo;


import com.dealflow.billing.models.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    Page<Payment> findByCustomerId(UUID customerId, Pageable pageable);

    @Query("""
            select p from Payment p
             where p.recordedAt >= :from and p.recordedAt < :to
               and (:customerId is null or p.customerId = :customerId)
             order by p.recordedAt desc
            """)
    List<Payment> findRecordedBetween(@Param("from") Instant from,
                                      @Param("to") Instant to,
                                      @Param("customerId") UUID customerId);

    /** Total received from a customer, used to cap refunds at money actually paid. */
    @Query("select coalesce(sum(p.amountMinor), 0) from Payment p where p.customerId = :customerId")
    long sumReceivedFrom(@Param("customerId") UUID customerId);

    @Query(value = "select nextval('dealflow.payment_reference_seq')", nativeQuery = true)
    long nextReferenceNumber();
}
