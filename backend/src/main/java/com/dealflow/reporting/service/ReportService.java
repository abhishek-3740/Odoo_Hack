package com.dealflow.reporting.service;


import com.dealflow.reporting.dto.*;
import com.dealflow.reporting.controller.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.billing.models.Invoice;
import com.dealflow.billing.repo.InvoiceRepository;
import com.dealflow.billing.models.Payment;
import com.dealflow.billing.repo.PaymentRepository;
import com.dealflow.catalog.models.Category;
import com.dealflow.catalog.repo.CategoryRepository;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.catalog.models.Product;
import com.dealflow.catalog.repo.ProductRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.models.OrderLine;
import com.dealflow.orders.repo.OrderLineRepository;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.models.QuoteRevision;
import com.dealflow.quotes.repo.QuoteRevisionRepository;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.reporting.dto.ReportDtos.CategoryRow;
import com.dealflow.reporting.dto.ReportDtos.ProductRow;
import com.dealflow.reporting.dto.ReportDtos.QuoteRow;
import com.dealflow.reporting.dto.ReportDtos.RepRow;
import com.dealflow.reporting.dto.ReportDtos.ReportFilter;
import com.dealflow.reporting.dto.ReportDtos.SalesReport;
import com.dealflow.reporting.dto.ReportDtos.StageCount;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessCalendar;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Builds the sales report from persisted records.
 *
 * <h2>Role scoping is applied here, not in the controller</h2>
 *
 * <p>A rep's filter is forced to their own id; a manager's to their team. The
 * export endpoints call this same method, so a spreadsheet can never contain a
 * row the screen would not have shown (test T24).
 *
 * <h2>Current revision only</h2>
 *
 * <p>Pipeline value and approval status come from each quotation's
 * <em>current</em> revision. Superseded revisions are history, and counting
 * them would double the pipeline every time a customer countered.
 */
@Service
public class ReportService {

    private static final List<Stage> OPEN_STAGES = List.of(
            Stage.DRAFT, Stage.REVIEW, Stage.SENT, Stage.UNDER_NEGOTIATION);

    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final OrderRepository orders;
    private final OrderLineRepository orderLines;
    private final InvoiceRepository invoices;
    private final PaymentRepository payments;
    private final ProfileRepository profiles;
    private final CustomerRepository customers;
    private final CategoryRepository categories;
    private final ProductRepository products;
    private final BusinessClock clock;
    private final AppProperties properties;

    public ReportService(QuoteRepository quotes, QuoteRevisionRepository revisions,
                         OrderRepository orders, OrderLineRepository orderLines,
                         InvoiceRepository invoices, PaymentRepository payments,
                         ProfileRepository profiles, CustomerRepository customers,
                         CategoryRepository categories, ProductRepository products,
                         BusinessClock clock, AppProperties properties) {
        this.quotes = quotes;
        this.revisions = revisions;
        this.orders = orders;
        this.orderLines = orderLines;
        this.invoices = invoices;
        this.payments = payments;
        this.profiles = profiles;
        this.customers = customers;
        this.categories = categories;
        this.products = products;
        this.clock = clock;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public SalesReport salesReport(ReportFilter requested, Actor actor) {
        ReportFilter filter = scope(requested, actor);
        LocalDate from = filter.from() == null ? clock.businessToday().minusDays(90) : filter.from();
        LocalDate to = filter.to() == null ? clock.businessToday().plusDays(1) : filter.to().plusDays(1);
        if (!to.isAfter(from)) {
            throw new ApiException(com.dealflow.shared.error.ErrorCode.VALIDATION_FAILED,
                    "The report end date must be on or after the start date.");
        }

        Instant fromInstant = from.atStartOfDay(clock.billingZone()).toInstant();
        Instant toInstant = to.atStartOfDay(clock.billingZone()).toInstant();

        // ---- quotations, by creation date, current revision only ----
        List<Quote> quoteRows = quotes.findCreatedBetween(fromInstant, toInstant,
                        filter.ownerProfileId(), filter.teamId()).stream()
                .filter(quote -> filter.customerId() == null
                        || filter.customerId().equals(quote.getCustomerId()))
                .filter(quote -> filter.stage() == null
                        || quote.getStage().name().equalsIgnoreCase(filter.stage()))
                .limit(properties.limits().maxExportRows())
                .toList();

        Map<UUID, QuoteRevision> currentRevisions = revisions.findAllById(
                        quoteRows.stream().map(Quote::getCurrentRevisionId)
                                .filter(Objects::nonNull).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(QuoteRevision::getId, revision -> revision));

        Map<UUID, Profile> people = profiles.findAllById(
                        quoteRows.stream().map(Quote::getOwnerProfileId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Profile::getId, profile -> profile));
        Map<UUID, Customer> customerRows = customers.findAllById(
                        quoteRows.stream().map(Quote::getCustomerId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Customer::getId, customer -> customer));

        // ---- orders, by confirmation date ----
        List<Order> orderRows = orders.findConfirmedBetween(fromInstant, toInstant,
                        filter.ownerProfileId()).stream()
                .filter(order -> order.getOrderStatus() == Order.OrderStatus.CONFIRMED)
                .filter(order -> filter.customerId() == null
                        || filter.customerId().equals(order.getCustomerId()))
                .filter(order -> filter.teamId() == null || belongsToTeam(order, people, filter.teamId()))
                .toList();
        List<OrderLine> lines = orderRows.isEmpty() ? List.of()
                : orderLines.findByOrderIdIn(orderRows.stream().map(Order::getId).toList());
        if (filter.categoryId() != null) {
            lines = lines.stream()
                    .filter(line -> filter.categoryId().equals(line.getCategoryId())).toList();
        }

        // ---- invoices by issue date, payments by recorded date ----
        List<Invoice> invoiceRows = invoices.findIssuedBetween(from, to, filter.customerId()).stream()
                .filter(invoice -> invoice.getStatus() != Invoice.InvoiceStatus.DRAFT
                        && invoice.getStatus() != Invoice.InvoiceStatus.VOID)
                .filter(invoice -> filter.ownerProfileId() == null
                        || ownedBy(invoice, orderRows, filter.ownerProfileId()))
                .toList();
        List<Payment> paymentRows = payments.findRecordedBetween(fromInstant, toInstant,
                filter.customerId());

        // ---- headline figures, kept separate on purpose ----
        long oneTimeSales = 0;
        BigDecimal mrrExact = BigDecimal.ZERO;
        for (OrderLine line : lines) {
            if (line.getLineKind() == LineKind.ONE_TIME) {
                oneTimeSales += line.getNetMinor();
            } else if (line.getIntervalMonths() != null) {
                mrrExact = mrrExact.add(BigDecimal.valueOf(line.getNetMinor())
                        .multiply(BusinessCalendar.monthlyNormalisationFactor(line.getIntervalMonths()),
                                Money.CALC));
            }
        }
        long invoiced = invoiceRows.stream().mapToLong(Invoice::getTotalMinor).sum();
        long outstanding = invoiceRows.stream().mapToLong(Invoice::outstandingMinor).sum();
        long collected = paymentRows.stream().mapToLong(Payment::getAmountMinor).sum();

        return new SalesReport(
                new ReportFilter(from, to.minusDays(1), filter.ownerProfileId(), filter.teamId(),
                        filter.customerId(), filter.stage(), filter.categoryId()),
                properties.billing().defaultCurrency(),
                clock.now(),
                quoteRows.size(), orderRows.size(), invoiceRows.size(), paymentRows.size(),
                Money.toMajor(oneTimeSales),
                Money.toMajor(mrrExact.setScale(0, RoundingMode.HALF_UP).longValueExact()),
                Money.toMajor(invoiced),
                Money.toMajor(collected),
                Money.toMajor(outstanding),
                pipeline(quoteRows, currentRevisions),
                byRep(quoteRows, currentRevisions, orderRows, lines, people),
                byCategory(lines),
                topProducts(lines),
                quoteRowsFor(quoteRows, currentRevisions, people, customerRows));
    }

    // -------------------------------------------------------------- scoping

    /** Narrows the filter to what this actor is allowed to see. */
    private ReportFilter scope(ReportFilter requested, Actor actor) {
        ReportFilter filter = requested == null
                ? new ReportFilter(null, null, null, null, null, null, null) : requested;
        return switch (actor.role()) {
            case REP -> new ReportFilter(filter.from(), filter.to(), actor.profileId(), null,
                    filter.customerId(), filter.stage(), filter.categoryId());
            case MANAGER -> new ReportFilter(filter.from(), filter.to(),
                    filter.ownerProfileId(),
                    actor.teamId() != null ? actor.teamId() : filter.teamId(),
                    filter.customerId(), filter.stage(), filter.categoryId());
            case FINANCE, ADMIN -> filter;
            case CUSTOMER -> throw ApiException.forbidden("Reports are not available on the portal.");
        };
    }

    private static boolean belongsToTeam(Order order, Map<UUID, Profile> people, UUID teamId) {
        Profile owner = people.get(order.getOwnerProfileId());
        return owner != null && teamId.equals(owner.getTeamId());
    }

    private static boolean ownedBy(Invoice invoice, List<Order> orderRows, UUID ownerProfileId) {
        if (invoice.getOrderId() == null) {
            return false;
        }
        return orderRows.stream().anyMatch(order -> order.getId().equals(invoice.getOrderId())
                && ownerProfileId.equals(order.getOwnerProfileId()));
    }

    // ---------------------------------------------------------- breakdowns

    private List<StageCount> pipeline(List<Quote> quoteRows, Map<UUID, QuoteRevision> current) {
        Map<Stage, long[]> counts = new LinkedHashMap<>();
        for (Stage stage : Stage.values()) {
            counts.put(stage, new long[2]);
        }
        for (Quote quote : quoteRows) {
            long[] bucket = counts.get(quote.getStage());
            bucket[0]++;
            QuoteRevision revision = current.get(quote.getCurrentRevisionId());
            if (revision != null) {
                bucket[1] += revision.getOneTimeNetMinor();
            }
        }
        return counts.entrySet().stream()
                .filter(entry -> entry.getValue()[0] > 0)
                .map(entry -> new StageCount(entry.getKey().name(), entry.getValue()[0],
                        Money.toMajor(entry.getValue()[1])))
                .toList();
    }

    private List<RepRow> byRep(List<Quote> quoteRows, Map<UUID, QuoteRevision> current,
                               List<Order> orderRows, List<OrderLine> lines, Map<UUID, Profile> people) {
        Map<UUID, List<Quote>> quotesByOwner = quoteRows.stream()
                .collect(Collectors.groupingBy(Quote::getOwnerProfileId));
        Map<UUID, List<Order>> ordersByOwner = orderRows.stream()
                .collect(Collectors.groupingBy(Order::getOwnerProfileId));
        Map<UUID, UUID> orderOwner = orderRows.stream()
                .collect(Collectors.toMap(Order::getId, Order::getOwnerProfileId));

        Set<UUID> owners = new java.util.HashSet<>(quotesByOwner.keySet());
        owners.addAll(ordersByOwner.keySet());

        List<RepRow> rows = new ArrayList<>();
        for (UUID ownerId : owners) {
            List<Quote> ownerQuotes = quotesByOwner.getOrDefault(ownerId, List.of());
            List<Order> ownerOrders = ordersByOwner.getOrDefault(ownerId, List.of());

            long oneTime = 0;
            BigDecimal mrr = BigDecimal.ZERO;
            for (OrderLine line : lines) {
                if (!ownerId.equals(orderOwner.get(line.getOrderId()))) {
                    continue;
                }
                if (line.getLineKind() == LineKind.ONE_TIME) {
                    oneTime += line.getNetMinor();
                } else if (line.getIntervalMonths() != null) {
                    mrr = mrr.add(BigDecimal.valueOf(line.getNetMinor()).multiply(
                            BusinessCalendar.monthlyNormalisationFactor(line.getIntervalMonths()),
                            Money.CALC));
                }
            }

            BigDecimal discountSum = BigDecimal.ZERO;
            int discountCount = 0;
            for (Quote quote : ownerQuotes) {
                QuoteRevision revision = current.get(quote.getCurrentRevisionId());
                if (revision != null && revision.getTotalBaseMinor() > 0) {
                    discountSum = discountSum.add(BigDecimal.valueOf(revision.getTotalDiscountMinor())
                            .multiply(BigDecimal.valueOf(100))
                            .divide(BigDecimal.valueOf(revision.getTotalBaseMinor()), 4,
                                    RoundingMode.HALF_UP));
                    discountCount++;
                }
            }

            Profile owner = people.get(ownerId);
            if (owner == null) {
                owner = profiles.findById(ownerId).orElse(null);
            }
            rows.add(new RepRow(ownerId, owner == null ? "Unknown" : displayName(owner),
                    ownerQuotes.size(), ownerOrders.size(),
                    Money.toMajor(oneTime),
                    Money.toMajor(mrr.setScale(0, RoundingMode.HALF_UP).longValueExact()),
                    discountCount == 0 ? null
                            : discountSum.divide(BigDecimal.valueOf(discountCount), 2, RoundingMode.HALF_UP)));
        }
        rows.sort(Comparator.comparing(RepRow::oneTimeSales).reversed());
        return rows;
    }

    private List<CategoryRow> byCategory(List<OrderLine> lines) {
        Map<UUID, Category> categoryRows = categories.findAll().stream()
                .collect(Collectors.toMap(Category::getId, category -> category));
        Map<UUID, long[]> totals = new LinkedHashMap<>();
        for (OrderLine line : lines) {
            long[] bucket = totals.computeIfAbsent(line.getCategoryId(), key -> new long[4]);
            long cost = line.getQuantity().multiply(BigDecimal.valueOf(line.getUnitCostMinor()))
                    .setScale(0, RoundingMode.HALF_UP).longValueExact();
            if (line.getLineKind() == LineKind.ONE_TIME) {
                bucket[0] += line.getNetMinor();
            } else {
                bucket[1] += line.getNetMinor();
            }
            bucket[2] += line.getNetMinor() - cost;
            bucket[3]++;
        }
        return totals.entrySet().stream()
                .map(entry -> {
                    Category category = categoryRows.get(entry.getKey());
                    long[] bucket = entry.getValue();
                    long net = bucket[0] + bucket[1];
                    return new CategoryRow(entry.getKey(),
                            category == null ? "UNKNOWN" : category.getCode(),
                            category == null ? "Unknown" : category.getName(),
                            Money.toMajor(bucket[0]), Money.toMajor(bucket[1]),
                            Money.toMajor(bucket[2]), Money.percentOf(bucket[2], net), bucket[3]);
                })
                .sorted(Comparator.comparing(CategoryRow::oneTimeSales).reversed())
                .toList();
    }

    private List<ProductRow> topProducts(List<OrderLine> lines) {
        Map<UUID, Product> productRows = products.findAllById(
                        lines.stream().map(OrderLine::getProductId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Product::getId, product -> product));
        Map<UUID, Object[]> totals = new LinkedHashMap<>();
        for (OrderLine line : lines) {
            Object[] bucket = totals.computeIfAbsent(line.getProductId(),
                    key -> new Object[]{BigDecimal.ZERO, 0L, new java.util.HashSet<UUID>()});
            bucket[0] = ((BigDecimal) bucket[0]).add(line.getQuantity());
            bucket[1] = (Long) bucket[1] + line.getNetMinor();
            @SuppressWarnings("unchecked")
            Set<UUID> orderIds = (Set<UUID>) bucket[2];
            orderIds.add(line.getOrderId());
        }
        return totals.entrySet().stream()
                .map(entry -> {
                    Product product = productRows.get(entry.getKey());
                    Object[] bucket = entry.getValue();
                    return new ProductRow(entry.getKey(),
                            product == null ? "?" : product.getCode(),
                            product == null ? "Unknown" : product.getName(),
                            (BigDecimal) bucket[0], Money.toMajor((Long) bucket[1]),
                            ((Set<?>) bucket[2]).size());
                })
                .sorted(Comparator.comparing(ProductRow::net).reversed())
                .limit(10)
                .toList();
    }

    private List<QuoteRow> quoteRowsFor(List<Quote> quoteRows, Map<UUID, QuoteRevision> current,
                                        Map<UUID, Profile> people, Map<UUID, Customer> customerRows) {
        return quoteRows.stream()
                .map(quote -> {
                    QuoteRevision revision = current.get(quote.getCurrentRevisionId());
                    Profile owner = people.get(quote.getOwnerProfileId());
                    Customer customer = customerRows.get(quote.getCustomerId());
                    return new QuoteRow(quote.getId(), quote.getReference(),
                            customer == null ? "?" : customer.getName(),
                            owner == null ? "?" : displayName(owner),
                            quote.getStage().name(),
                            revision == null ? "NOT_EVALUATED" : revision.getApprovalStatus().name(),
                            revision == null ? "INR" : revision.getCurrency(),
                            revision == null ? BigDecimal.ZERO : Money.toMajor(revision.getOneTimeNetMinor()),
                            revision == null ? BigDecimal.ZERO
                                    : Money.toMajor(revision.getRecurringFirstCycleNetMinor()),
                            revision == null ? null : revision.getMarginPercent(),
                            quote.getCreatedAt().atZone(clock.billingZone()).toLocalDate());
                })
                .toList();
    }

    private static String displayName(Profile profile) {
        return profile.getFullName() != null ? profile.getFullName() : profile.getEmail();
    }
}
