package com.dealflow.config;

import java.time.Clock;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableConfigurationProperties(AppProperties.class)
@EnableScheduling
public class CoreConfig {

    /**
     * One injectable clock for the whole application. Nothing calls
     * {@code Instant.now()} directly in domain code, so "is this quote stalled"
     * can be tested at 71:59:59 and 72:00:00 without waiting three days.
     */
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
