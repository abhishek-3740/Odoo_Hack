package com.dealflow.fulfillment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BackorderRepository extends JpaRepository<Backorder, UUID> {

    List<Backorder> findByOrderId(UUID orderId);

    @Query("""
            select b from Backorder b
             where b.orderId = :orderId
               and b.status = com.dealflow.fulfillment.Backorder.BackorderStatus.OPEN
            """)
    List<Backorder> findOpenForOrder(@Param("orderId") UUID orderId);

    @Query("""
            select b from Backorder b
             where b.orderLineId = :orderLineId
               and b.status = com.dealflow.fulfillment.Backorder.BackorderStatus.OPEN
            """)
    Optional<Backorder> findOpenForLine(@Param("orderLineId") UUID orderLineId);

    /** Open shortages for a variant, oldest first, for consolidation after a receipt. */
    @Query("""
            select b from Backorder b
             where b.variantId = :variantId
               and b.status = com.dealflow.fulfillment.Backorder.BackorderStatus.OPEN
             order by b.createdAt asc
            """)
    List<Backorder> findOpenForVariant(@Param("variantId") UUID variantId);

    @Query("""
            select b from Backorder b
             where b.status = com.dealflow.fulfillment.Backorder.BackorderStatus.OPEN
            """)
    List<Backorder> findAllOpen();
}
