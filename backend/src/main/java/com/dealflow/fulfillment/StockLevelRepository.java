package com.dealflow.fulfillment;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockLevelRepository extends JpaRepository<StockLevel, UUID> {

    Optional<StockLevel> findByWarehouseIdAndVariantId(UUID warehouseId, UUID variantId);

    List<StockLevel> findByVariantIdIn(Collection<UUID> variantIds);

    List<StockLevel> findByWarehouseId(UUID warehouseId);

    /**
     * Locks the stock rows for a set of variants, in a stable order.
     *
     * <p>The ordering matters as much as the lock. Two orders touching the same
     * two SKUs will always take those rows in the same {@code (variant, warehouse)}
     * sequence, so they queue behind each other instead of deadlocking.
     *
     * <p>This is the single place where availability becomes authoritative.
     * Anything read outside this lock is a preview, however recent — which is
     * exactly why a preview never reserves anything (edge case E10).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select s from StockLevel s
             where s.variantId in :variantIds
             order by s.variantId asc, s.warehouseId asc
            """)
    List<StockLevel> lockByVariantIds(@Param("variantIds") Collection<UUID> variantIds);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from StockLevel s where s.variantId = :variantId and s.warehouseId = :warehouseId")
    Optional<StockLevel> lockOne(@Param("variantId") UUID variantId,
                                 @Param("warehouseId") UUID warehouseId);

    /** Rows at or below their reorder threshold, for the replenishment sweep. */
    @Query("""
            select s from StockLevel s
             where s.reorderPoint > 0
               and (s.onHand - s.reserved) <= s.reorderPoint
            """)
    List<StockLevel> findNeedingReplenishment();
}
