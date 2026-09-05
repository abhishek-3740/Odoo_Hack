package com.dealflow.billing.repo;


import com.dealflow.billing.models.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {

    List<Subscription> findByOrderId(UUID orderId);

    Optional<Subscription> findByOrderLineId(UUID orderLineId);

    Page<Subscription> findByCustomerId(UUID customerId, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Subscription s where s.id = :id")
    Optional<Subscription> findByIdForUpdate(@Param("id") UUID id);

    /**
     * Subscriptions whose next charge is due.
     *
     * <p>Bounded by design. A long outage leaves a backlog; the job takes a
     * batch, commits it, and comes back for the rest, so one bad run cannot hold
     * a transaction open across thousands of rows.
     */
    @Query("""
            select s from Subscription s
             where s.nextBillAt is not null
               and s.nextBillAt <= :businessDate
               and s.status in (com.dealflow.billing.models.Subscription.SubscriptionStatus.ACTIVE,
                                com.dealflow.billing.models.Subscription.SubscriptionStatus.CANCEL_AT_PERIOD_END)
             order by s.nextBillAt asc
            """)
    List<Subscription> findDue(@Param("businessDate") LocalDate businessDate, Limit limit);

    @Query(value = "select nextval('dealflow.invoice_number_seq')", nativeQuery = true)
    long nextInvoiceNumber();
}
