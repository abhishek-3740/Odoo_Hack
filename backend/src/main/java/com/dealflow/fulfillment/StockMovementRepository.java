package com.dealflow.fulfillment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StockMovementRepository extends JpaRepository<StockMovement, UUID> {

    Optional<StockMovement> findByRequestKey(String requestKey);

    boolean existsByRequestKey(String requestKey);

    List<StockMovement> findByVariantIdAndWarehouseIdOrderByOccurredAtDesc(UUID variantId, UUID warehouseId);

    List<StockMovement> findByReferenceTypeAndReferenceId(String referenceType, UUID referenceId);
}
