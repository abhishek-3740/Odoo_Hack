package com.dealflow.orders.controller;


import com.dealflow.orders.models.*;
import com.dealflow.orders.repo.*;
import com.dealflow.orders.service.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read access to confirmed orders. Orders are created only by the coordinator. */
@RestController
@RequestMapping("/api/v1/orders")
public class OrderController {

    private static final Set<String> SORTS = Set.of("confirmedAt", "createdAt", "fulfillmentStatus");

    public record OrderLineResponse(UUID id, String lineKey, String lineKind, UUID variantId, UUID planId,
                                    String description, BigDecimal quantity, BigDecimal unitPrice,
                                    int effectiveDiscountBp, BigDecimal net, BigDecimal tax,
                                    Integer intervalMonths, boolean requiresStock, LocalDate promisedDate) {
    }

    public record OrderResponse(UUID id, String reference, UUID quoteId, UUID revisionId, UUID customerId,
                                String customerName, UUID ownerProfileId, String currency,
                                String orderStatus, String fulfillmentStatus, String billingStatus,
                                String backorderTerms, BigDecimal oneTimeNet, BigDecimal oneTimeTax,
                                Instant confirmedAt, List<OrderLineResponse> lines, long rowVersion) {
    }

    private final OrderRepository orders;
    private final OrderLineRepository orderLines;
    private final CustomerRepository customers;

    public OrderController(OrderRepository orders, OrderLineRepository orderLines,
                           CustomerRepository customers) {
        this.orders = orders;
        this.orderLines = orderLines;
        this.customers = customers;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<OrderResponse>> list(
            @RequestParam(required = false) UUID customerId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize,
            @RequestParam(required = false) String sort,
            Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Use the portal endpoints.");
        }
        UUID owner = actor.role() == Role.REP ? actor.profileId() : null;
        Page<Order> result = orders.search(customerId, owner,
                Paging.of(page, pageSize, sort, SORTS, "confirmedAt"));
        return ApiResponse.of(PageResponse.of(result, this::toResponse));
    }

    @GetMapping("/{orderId}")
    @Transactional(readOnly = true)
    public ApiResponse<OrderResponse> get(@PathVariable UUID orderId, Actor actor) {
        return ApiResponse.of(toResponse(loadVisible(orderId, actor)));
    }

    /** Loads an order the actor may see; a foreign order is indistinguishable from a missing one. */
    public Order loadVisible(UUID orderId, Actor actor) {
        Order order = orders.findById(orderId).orElseThrow(() -> ApiException.notFound("Order " + orderId));
        boolean visible = switch (actor.role()) {
            case ADMIN, FINANCE, MANAGER -> true;
            case REP -> Objects.equals(actor.profileId(), order.getOwnerProfileId());
            case CUSTOMER -> false;
        };
        if (!visible) {
            throw ApiException.notFound("Order " + orderId);
        }
        return order;
    }

    public OrderResponse toResponse(Order order) {
        Customer customer = customers.findById(order.getCustomerId()).orElse(null);
        List<OrderLineResponse> lines = orderLines.findByOrderIdOrderByPositionAsc(order.getId()).stream()
                .map(line -> new OrderLineResponse(line.getId(), line.getLineKey(),
                        line.getLineKind().name(), line.getVariantId(), line.getPlanId(),
                        line.getDescription(), line.getQuantity(), Money.toMajor(line.getUnitPriceMinor()),
                        line.getEffectiveDiscountBp(), Money.toMajor(line.getNetMinor()),
                        Money.toMajor(line.getTaxMinor()), line.getIntervalMonths(),
                        line.isRequiresStock(), line.getPromisedDate()))
                .toList();
        return new OrderResponse(order.getId(), order.getReference(), order.getQuoteId(),
                order.getRevisionId(), order.getCustomerId(),
                customer == null ? null : customer.getName(), order.getOwnerProfileId(),
                order.getCurrency(), order.getOrderStatus().name(), order.getFulfillmentStatus().name(),
                order.getBillingStatus().name(), order.getBackorderTerms().name(),
                Money.toMajor(order.getOneTimeNetMinor()), Money.toMajor(order.getOneTimeTaxMinor()),
                order.getConfirmedAt(), lines, order.getRowVersion());
    }
}
