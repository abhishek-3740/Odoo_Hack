package com.dealflow.orders.repo;


import com.dealflow.orders.models.*;
import com.dealflow.orders.service.*;
import com.dealflow.orders.controller.*;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderLineRepository extends JpaRepository<OrderLine, UUID> {

    List<OrderLine> findByOrderIdOrderByPositionAsc(UUID orderId);

    List<OrderLine> findByOrderIdIn(Collection<UUID> orderIds);
}
