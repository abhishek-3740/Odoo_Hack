package com.dealflow.fulfillment;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WarehouseRepository extends JpaRepository<Warehouse, UUID> {

    Optional<Warehouse> findByCode(String code);

    List<Warehouse> findByActiveTrueOrderBySortOrderAscCodeAsc();
}
