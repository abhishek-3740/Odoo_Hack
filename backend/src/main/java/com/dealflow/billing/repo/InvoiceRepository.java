package com.dealflow.billing.repo;


import com.dealflow.billing.models.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InvoiceRepository extends JpaRepository<Invoice, UUID> {

    List<Invoice> findByOrderId(UUID orderId);

    List<Invoice> findBySubscriptionId(UUID subscriptionId);

    Page<Invoice> findByCustomerId(UUID customerId, Pageable pageable);

    Optional<Invoice> findByReference(String reference);

    /**
     * Locks invoices for settlement, in a stable id order.
     *
     * <p>Two payments touching the same invoices always take them in the same
     * sequence, so concurrent allocations queue rather than deadlock, and the
     * outstanding figure each one reads is the real one.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from Invoice i where i.id in :ids order by i.id asc")
    List<Invoice> lockAll(@Param("ids") Collection<UUID> ids);

    @Query("""
            select i from Invoice i
             where i.customerId = :customerId
               and i.status in (com.dealflow.billing.models.Invoice.InvoiceStatus.ISSUED,
                                com.dealflow.billing.models.Invoice.InvoiceStatus.PARTIALLY_PAID)
             order by i.dueDate asc nulls last, i.invoiceNo asc
            """)
    List<Invoice> findOpenForCustomer(@Param("customerId") UUID customerId);

    @Query("""
            select i from Invoice i
             where i.issueDate >= :from and i.issueDate < :to
               and (:customerId is null or i.customerId = :customerId)
             order by i.issueDate desc
            """)
    List<Invoice> findIssuedBetween(@Param("from") LocalDate from,
                                    @Param("to") LocalDate to,
                                    @Param("customerId") UUID customerId);

    @Query("""
            select i from Invoice i
             where i.dueDate < :businessDate
               and i.status in (com.dealflow.billing.models.Invoice.InvoiceStatus.ISSUED,
                                com.dealflow.billing.models.Invoice.InvoiceStatus.PARTIALLY_PAID)
            """)
    List<Invoice> findOverdue(@Param("businessDate") LocalDate businessDate);
}
