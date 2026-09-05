package com.dealflow.fulfillment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ShipmentRepository extends JpaRepository<Shipment, UUID> {

    List<Shipment> findByOrderId(UUID orderId);

    /** The open parcel for this destination, if one is already waiting to go out. */
    @Query("""
            select s from Shipment s
             where s.orderId = :orderId
               and s.warehouseId = :warehouseId
               and s.status in (com.dealflow.fulfillment.Shipment.ShipmentStatus.DRAFT,
                                com.dealflow.fulfillment.Shipment.ShipmentStatus.RESERVED)
            """)
    Optional<Shipment> findOpenForWarehouse(@Param("orderId") UUID orderId,
                                            @Param("warehouseId") UUID warehouseId);

    @Query("""
            select s from Shipment s
             where s.orderId = :orderId
               and s.status in (com.dealflow.fulfillment.Shipment.ShipmentStatus.DRAFT,
                                com.dealflow.fulfillment.Shipment.ShipmentStatus.RESERVED)
            """)
    List<Shipment> findOpenForOrder(@Param("orderId") UUID orderId);
}
