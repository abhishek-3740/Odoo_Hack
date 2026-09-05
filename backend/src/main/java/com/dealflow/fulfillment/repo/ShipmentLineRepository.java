package com.dealflow.fulfillment.repo;


import com.dealflow.fulfillment.models.*;
import com.dealflow.fulfillment.service.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.fulfillment.controller.*;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ShipmentLineRepository extends JpaRepository<ShipmentLine, UUID> {

    List<ShipmentLine> findByShipmentId(UUID shipmentId);

    List<ShipmentLine> findByShipmentIdIn(Collection<UUID> shipmentIds);

    List<ShipmentLine> findByOrderLineId(UUID orderLineId);

    Optional<ShipmentLine> findByShipmentIdAndOrderLineId(UUID shipmentId, UUID orderLineId);
}
