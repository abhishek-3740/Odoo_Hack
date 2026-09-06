package com.dealflow.seed;

import com.dealflow.catalog.models.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.models.CatalogEnums.CancellationPolicy;
import com.dealflow.catalog.models.CatalogEnums.ChargeKind;
import com.dealflow.catalog.models.CatalogEnums.FulfillmentKind;
import com.dealflow.catalog.models.CatalogEnums.ProrationPolicy;
import com.dealflow.catalog.models.CatalogEnums.QuantityMode;
import com.dealflow.catalog.models.Category;
import com.dealflow.catalog.models.Product;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.catalog.models.SubscriptionPlan;
import com.dealflow.catalog.repo.CategoryRepository;
import com.dealflow.catalog.repo.ProductRepository;
import com.dealflow.catalog.repo.ProductVariantRepository;
import com.dealflow.catalog.repo.SubscriptionPlanRepository;
import com.dealflow.fulfillment.models.StockLevel;
import com.dealflow.fulfillment.models.Warehouse;
import com.dealflow.fulfillment.repo.StockLevelRepository;
import com.dealflow.fulfillment.repo.WarehouseRepository;
import java.math.BigDecimal;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * The wider storefront catalogue: enough hardware, services and subscriptions
 * for the public homepage to look like a shop rather than a fixture.
 *
 * <p>Idempotent on product code, SKU and plan code, and safe to run on every
 * start even after the core seed has already been applied. Nothing here is
 * referenced by the scripted demo flows, so the four original products keep
 * their exact prices and stock.
 */
@Component
public class DemoCatalogExtras {

    private static final String PLACEHOLDER_DESCRIPTION = "Synthetic demo product";

    private final CategoryRepository categories;
    private final ProductRepository products;
    private final ProductVariantRepository variants;
    private final SubscriptionPlanRepository plans;
    private final WarehouseRepository warehouses;
    private final StockLevelRepository stockLevels;
    private final ObjectMapper objectMapper;

    public DemoCatalogExtras(CategoryRepository categories, ProductRepository products,
                             ProductVariantRepository variants, SubscriptionPlanRepository plans,
                             WarehouseRepository warehouses, StockLevelRepository stockLevels,
                             ObjectMapper objectMapper) {
        this.categories = categories;
        this.products = products;
        this.variants = variants;
        this.plans = plans;
        this.warehouses = warehouses;
        this.stockLevels = stockLevels;
        this.objectMapper = objectMapper;
    }

    public void seed() {
        Category hardware = categories.findByCode("HARDWARE").orElse(null);
        Category service = categories.findByCode("SERVICE").orElse(null);
        Category subscription = categories.findByCode("SUBSCRIPTION").orElse(null);
        Warehouse main = warehouses.findByCode("MAIN").orElse(null);
        Warehouse east = warehouses.findByCode("EAST").orElse(null);
        if (hardware == null || service == null || subscription == null || main == null || east == null) {
            return;
        }

        describeOriginals();

        // ---- hardware: one-time, stocked -------------------------------------
        Product monitor = product(hardware, "MONITOR", "4K Professional Monitor",
                "Factory-calibrated IPS panel with USB-C power delivery, ideal for finance and design desks.",
                2_500_000L, 1_800_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, true);
        ProductVariant mon27 = variant(monitor, "MON-27-4K", "27\" 4K Monitor", 0L, 6_200,
                Map.of("size", "27\"", "resolution", "3840x2160"));
        ProductVariant mon32 = variant(monitor, "MON-32-4K", "32\" 4K Monitor", 800_000L, 8_900,
                Map.of("size", "32\"", "resolution", "3840x2160"));

        Product peripherals = product(hardware, "KBM-KIT", "Wireless Keyboard & Mouse Kit",
                "Low-profile keyboard and precision mouse with a shared receiver and three-year battery life.",
                350_000L, 200_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, false);
        ProductVariant kbm = variant(peripherals, "KBM-STD", "Keyboard & Mouse Kit", 0L, 900,
                Map.of("layout", "US-INTL"));

        Product server = product(hardware, "SERVER", "Rack Server 1U",
                "Dual-socket 1U server with redundant power supplies, remote management and NVMe boot drives.",
                18_000_000L, 13_500_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, false);
        ProductVariant srv32 = variant(server, "SRV-1U-32", "Rack Server 1U — 32 GB", 0L, 18_000,
                Map.of("memory", "32 GB", "cores", "16"));
        ProductVariant srv64 = variant(server, "SRV-1U-64", "Rack Server 1U — 64 GB", 4_000_000L, 18_200,
                Map.of("memory", "64 GB", "cores", "16"));

        Product networkSwitch = product(hardware, "SWITCH", "48-Port Managed PoE Switch",
                "Layer-3 managed switch with 48 PoE+ ports and four 10G uplinks for office and branch deployments.",
                6_500_000L, 4_500_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, false);
        ProductVariant sw48 = variant(networkSwitch, "SW-48-POE", "48-Port PoE Switch", 0L, 5_400,
                Map.of("ports", "48", "uplinks", "4x10G"));

        Product phone = product(hardware, "IP-PHONE", "IP Desk Phone",
                "SIP desk phone with colour display, HD audio and a dedicated PoE port; works with any hosted PBX.",
                800_000L, 500_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, false);
        ProductVariant phoneStd = variant(phone, "PHONE-STD", "IP Desk Phone", 0L, 1_100,
                Map.of("lines", "6"));

        Product tablet = product(hardware, "TABLET", "Field Tablet 11\"",
                "Rugged 11-inch tablet for warehouse and field teams, with LTE and an eight-hour shift battery.",
                4_500_000L, 3_200_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, false);
        ProductVariant tabletLte = variant(tablet, "TAB-11-LTE", "Field Tablet 11\" LTE", 0L, 700,
                Map.of("storage", "256 GB", "connectivity", "LTE"));

        stock(main, mon27, "12", "4", "16");
        stock(east, mon27, "3", "2", "6");
        stock(main, mon32, "5", "2", "8");
        stock(main, kbm, "40", "10", "50");
        stock(east, kbm, "15", "5", "20");
        stock(main, srv32, "3", "1", "4");
        stock(main, srv64, "2", "1", "3");
        stock(main, sw48, "6", "2", "8");
        stock(east, sw48, "2", "1", "3");
        stock(main, phoneStd, "60", "20", "80");
        stock(east, phoneStd, "20", "10", "30");
        stock(main, tabletLte, "8", "3", "10");

        // A bounded demo expansion: three products, four variants; no invented order history.
        Product camera = product(hardware, "MEETING-CAM", "Meeting Room Camera",
                "USB conference camera for hybrid teams, with privacy shutter and a wide field of view.",
                1_200_000L, 700_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, true);
        ProductVariant camHd = variant(camera, "CAM-HD", "Meeting Camera HD", 0L, 400, Map.of("resolution", "1080p"));
        ProductVariant cam4k = variant(camera, "CAM-4K", "Meeting Camera 4K", 700_000L, 500, Map.of("resolution", "4K"));
        compatible("MEETING-CAMERA", camHd, cam4k);
        stock(main, camHd, "8", "2", "10");
        stock(main, cam4k, "4", "1", "6");
        Product headset = product(hardware, "HEADSET", "Team Wireless Headset",
                "Noise-isolating USB headset for support desks and video meetings.",
                600_000L, 330_000L, FulfillmentKind.STOCK, QuantityMode.INTEGER, true);
        ProductVariant audio = variant(headset, "HEADSET-USB", "Wireless USB Headset", 0L, 250, Map.of("connection", "USB"));
        stock(main, audio, "12", "3", "15");
        Product audit = product(service, "WORKPLACE-SETUP", "Hybrid Workplace Setup",
                "Configure conferencing devices and test one meeting room with your team.",
                1_500_000L, 900_000L, FulfillmentKind.NONE, QuantityMode.INTEGER, false);
        variant(audit, "ROOM-SETUP", "Meeting Room Setup", 0L, 0, Map.of("unit", "room"));
        compatible("DISPLAY-4K", mon27, mon32);
        compatible("RACK-1U", srv32, srv64);

        // ---- services: one-time, not stocked ---------------------------------
        Product training = product(service, "TRAINING", "Staff Training Day",
                "On-site instructor-led training for up to twelve people, with materials and a follow-up session.",
                2_500_000L, 1_500_000L, FulfillmentKind.NONE, QuantityMode.DECIMAL, false);
        variant(training, "TRAIN-DAY", "Training Day (up to 12 people)", 0L, 0, Map.of("duration", "1 day"));

        Product migration = product(service, "MIGRATION", "Data Migration Service",
                "Assessment, migration and validation of an existing system, delivered by a named project lead.",
                12_000_000L, 8_000_000L, FulfillmentKind.NONE, QuantityMode.INTEGER, false);
        variant(migration, "MIG-STD", "Data Migration Package", 0L, 0, Map.of("scope", "standard"));

        Product install = product(service, "NET-INSTALL", "Network Installation",
                "Structured cabling, rack build and switch configuration for one office floor, tested and documented.",
                4_000_000L, 2_600_000L, FulfillmentKind.NONE, QuantityMode.INTEGER, false);
        variant(install, "NET-INSTALL-FLOOR", "Network Installation (per floor)", 0L, 0, Map.of("unit", "floor"));

        // ---- subscriptions: recurring plans ----------------------------------
        Product backup = product(subscription, "BACKUP", "Cloud Backup",
                "Encrypted off-site backup for servers and laptops with 90-day retention and one-click restore.",
                50_000L, 20_000L, FulfillmentKind.NONE, QuantityMode.INTEGER, true);
        plan(backup, "BACKUP-M", "Cloud Backup (monthly, per device)", 1, 50_000L, 20_000L);
        plan(backup, "BACKUP-Y", "Cloud Backup (yearly, per device)", 12, 540_000L, 216_000L);
        variant(backup, "BACKUP-DEVICE", "Cloud Backup device licence", 0L, 0, Map.of("unit", "device"));

        Product monitoring = product(subscription, "SECMON", "Security Monitoring",
                "24x7 managed detection and response across endpoints and cloud accounts, with monthly reporting.",
                120_000L, 50_000L, FulfillmentKind.NONE, QuantityMode.INTEGER, false);
        plan(monitoring, "SECMON-M", "Security Monitoring (monthly, per site)", 1, 120_000L, 50_000L);
        plan(monitoring, "SECMON-Y", "Security Monitoring (yearly, per site)", 12, 1_296_000L, 540_000L);
        variant(monitoring, "SECMON-SITE", "Security Monitoring site licence", 0L, 0, Map.of("unit", "site"));

        Product helpdesk = product(subscription, "HELPDESK", "Managed Helpdesk Seat",
                "Named-agent IT helpdesk for your staff: phone, chat and ticketing with a four-hour response SLA.",
                80_000L, 35_000L, FulfillmentKind.NONE, QuantityMode.INTEGER, false);
        plan(helpdesk, "HELPDESK-M", "Managed Helpdesk (monthly, per seat)", 1, 80_000L, 35_000L);
        plan(helpdesk, "HELPDESK-Q", "Managed Helpdesk (quarterly, per seat)", 3, 228_000L, 105_000L);
        variant(helpdesk, "HELPDESK-SEAT", "Managed Helpdesk seat", 0L, 0, Map.of("unit", "seat"));
    }

    /** The original four products were seeded with a placeholder blurb; give them real copy. */
    private void describeOriginals() {
        describe("LAPTOP", "Business-class laptop with a three-year on-site warranty, TPM 2.0 and docking support.");
        describe("DOCK", "Single-cable USB-C dock driving two 4K displays, wired networking and 100 W charging.");
        describe("SETUP", "Engineer-led deployment of your devices: imaging, enrolment and hand-over on site.");
        describe("SUPPORT", "Per-user support seat with priority ticketing and next-business-day hardware swap.");
    }

    private void describe(String code, String description) {
        products.findByCode(code)
                .filter(product -> product.getDescription() == null
                        || PLACEHOLDER_DESCRIPTION.equals(product.getDescription()))
                .ifPresent(product -> product.setDescription(description));
    }

    private void compatible(String group, ProductVariant... members) {
        // Preserve any deliberate administrator assignment on an existing variant.
        for (ProductVariant member : members) {
            if (member.getSubstitutionGroup() == null || member.getSubstitutionGroup().isBlank())
                member.setSubstitutionGroup(group);
        }
    }

    private Product product(Category category, String code, String name, String description, long priceMinor,
                            long costMinor, FulfillmentKind fulfillment, QuantityMode quantityMode,
                            boolean promoted) {
        ChargeKind charge = category.getKind() == com.dealflow.catalog.models.CatalogEnums.CategoryKind.SUBSCRIPTION
                ? ChargeKind.RECURRING : ChargeKind.ONE_TIME;
        return products.findByCode(code).orElseGet(() -> {
            Product product = new Product(category.getId(), code, name, priceMinor, costMinor, fulfillment, charge);
            product.setQuantityMode(quantityMode);
            product.setPromoted(promoted);
            product.setDescription(description);
            return products.save(product);
        });
    }

    private ProductVariant variant(Product product, String sku, String name, long extraMinor, int weightGrams,
                                   Map<String, String> attributes) {
        return variants.findBySku(sku).orElseGet(() -> {
            ProductVariant variant = new ProductVariant(product.getId(), sku, name);
            variant.setPriceExtraMinor(extraMinor);
            variant.setWeightGrams(weightGrams);
            variant.setAttributes(objectMapper.writeValueAsString(attributes));
            return variants.save(variant);
        });
    }

    private void plan(Product product, String code, String name, int months, long priceMinor, long costMinor) {
        plans.findByCode(code).orElseGet(() -> {
            SubscriptionPlan plan = new SubscriptionPlan(product.getId(), code, name, months, priceMinor, costMinor);
            plan.setBillingAnchor(BillingAnchor.CALENDAR_MONTH_START);
            plan.setProrationPolicy(ProrationPolicy.IMMEDIATE_PRORATED);
            plan.setCancellationPolicy(CancellationPolicy.IMMEDIATE_PRORATED);
            return plans.save(plan);
        });
    }

    private void stock(Warehouse warehouse, ProductVariant variant, String onHand, String reorder, String target) {
        if (stockLevels.findByWarehouseIdAndVariantId(warehouse.getId(), variant.getId()).isPresent()) {
            return;
        }
        StockLevel level = new StockLevel(warehouse.getId(), variant.getId());
        level.setOnHand(new BigDecimal(onHand));
        level.setReorderPoint(new BigDecimal(reorder));
        level.setTargetQty(new BigDecimal(target));
        stockLevels.save(level);
    }
}
