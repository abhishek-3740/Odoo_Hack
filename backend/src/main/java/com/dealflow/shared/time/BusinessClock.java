package com.dealflow.shared.time;

import com.dealflow.config.AppProperties;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The one source of "now" for the whole application.
 *
 * <p>Two different questions, deliberately answered by two different methods:
 *
 * <ul>
 *   <li>{@link #now()} — an instant on the timeline, always UTC. Elapsed-time
 *       rules use this. "Has this quotation been waiting 72 hours" is a
 *       {@code Duration} between two instants and gives the same answer whether
 *       the server runs in Mumbai, New York or UTC (edge case E21).</li>
 *   <li>{@link #businessToday()} — a calendar date in the company's billing
 *       timezone. Billing boundaries use this, because "the 1st of the month" is
 *       a local-calendar fact, not an instant.</li>
 * </ul>
 *
 * <p>Confusing the two is how a subscription gets billed a day early for
 * customers on the wrong side of midnight UTC.
 */
@Component
public class BusinessClock {

    private static final Logger log = LoggerFactory.getLogger(BusinessClock.class);

    private final Clock clock;
    private final ZoneId billingZone;
    private final LocalDate demoDateOverride;

    public BusinessClock(Clock clock, AppProperties properties) {
        this.clock = clock;
        this.billingZone = ZoneId.of(properties.billing().timezone());

        // A movable business date is a demo aid for showing a month elapsing on
        // stage. Outside demo mode it is ignored outright, so no request can
        // ever talk the server into backdating a charge.
        LocalDate override = null;
        String configured = properties.demo().businessDateOverride();
        if (properties.demo().mode() && configured != null && !configured.isBlank()) {
            override = LocalDate.parse(configured.trim());
            log.warn("DEMO MODE: business date pinned to {}. Never enable this outside a demo.", override);
        } else if (!properties.demo().mode() && configured != null && !configured.isBlank()) {
            log.warn("Ignoring demo business-date override because demo mode is off.");
        }
        this.demoDateOverride = override;
    }

    /** Current instant, UTC. Use for anything measured as elapsed time. */
    public Instant now() {
        return clock.instant();
    }

    /** Today's date in the billing timezone. Use for billing and calendar decisions. */
    public LocalDate businessToday() {
        return demoDateOverride != null ? demoDateOverride : LocalDate.now(clock.withZone(billingZone));
    }

    public ZoneId billingZone() {
        return billingZone;
    }

    public Clock clock() {
        return clock;
    }
}
