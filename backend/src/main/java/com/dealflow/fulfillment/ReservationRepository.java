package com.dealflow.fulfillment;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReservationRepository extends JpaRepository<Reservation, UUID> {

    List<Reservation> findByOrderId(UUID orderId);

    /**
     * Quantity of a line that has actually left the building.
     *
     * <p>Dispatched stock is never re-planned, so this is the floor that any
     * replan or manual override has to work above.
     */
    @Query("""
            select coalesce(sum(r.quantity), 0)
              from Reservation r
             where r.orderLineId = :orderLineId
               and r.status = com.dealflow.fulfillment.Reservation.ReservationStatus.CONSUMED
            """)
    BigDecimal sumDispatched(@Param("orderLineId") UUID orderLineId);

    @Query("""
            select r from Reservation r
             where r.orderId = :orderId
               and r.status = com.dealflow.fulfillment.Reservation.ReservationStatus.HELD
            """)
    List<Reservation> findHeldForOrder(@Param("orderId") UUID orderId);

    @Query("""
            select r from Reservation r
             where r.orderLineId = :orderLineId
               and r.status = com.dealflow.fulfillment.Reservation.ReservationStatus.HELD
            """)
    List<Reservation> findHeldForLine(@Param("orderLineId") UUID orderLineId);

    @Query("""
            select r from Reservation r
             where r.shipmentLineId = :shipmentLineId
               and r.status = com.dealflow.fulfillment.Reservation.ReservationStatus.HELD
            """)
    List<Reservation> findHeldForShipmentLine(@Param("shipmentLineId") UUID shipmentLineId);

    /**
     * How much of a (variant, warehouse) this order already holds.
     *
     * <p>Used when replanning: the order can re-use its own held stock, so
     * available-to-it is on_hand minus everyone else's reservations, not minus
     * its own as well.
     */
    @Query("""
            select coalesce(sum(r.quantity), 0)
              from Reservation r
             where r.orderId = :orderId
               and r.variantId = :variantId
               and r.warehouseId = :warehouseId
               and r.status = com.dealflow.fulfillment.Reservation.ReservationStatus.HELD
            """)
    BigDecimal sumOwnHeld(@Param("orderId") UUID orderId,
                          @Param("variantId") UUID variantId,
                          @Param("warehouseId") UUID warehouseId);
}
