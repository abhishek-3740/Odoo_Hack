package com.dealflow.orders;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OrderRepository extends JpaRepository<Order, UUID> {

    Optional<Order> findByQuoteId(UUID quoteId);

    Optional<Order> findByReference(String reference);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from Order o where o.id = :id")
    Optional<Order> findByIdForUpdate(@Param("id") UUID id);

    Page<Order> findByCustomerId(UUID customerId, Pageable pageable);

    @Query("""
            select o from Order o
             where (:customerId is null or o.customerId = :customerId)
               and (:ownerProfileId is null or o.ownerProfileId = :ownerProfileId)
            """)
    Page<Order> search(@Param("customerId") UUID customerId,
                       @Param("ownerProfileId") UUID ownerProfileId,
                       Pageable pageable);

    @Query("""
            select o from Order o
             where o.confirmedAt >= :from and o.confirmedAt < :to
               and (:ownerProfileId is null or o.ownerProfileId = :ownerProfileId)
             order by o.confirmedAt desc
            """)
    List<Order> findConfirmedBetween(@Param("from") Instant from,
                                     @Param("to") Instant to,
                                     @Param("ownerProfileId") UUID ownerProfileId);

    @Query(value = "select nextval('dealflow.order_reference_seq')", nativeQuery = true)
    long nextReferenceNumber();
}
