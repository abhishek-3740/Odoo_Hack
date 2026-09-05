package com.dealflow.config;

import java.time.Clock;
import org.apache.coyote.http11.Http11Nio2Protocol;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
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

    /**
     * Use Tomcat's asynchronous channel transport. Besides scaling well for
     * long-lived WebSocket connections, NIO2 avoids the JDK selector wake-up
     * pipe that can fail on Windows when Unix-domain loopback sockets are
     * unavailable or broken.
     */
    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> tomcatNio2Protocol() {
        return factory -> factory.setProtocol(Http11Nio2Protocol.class.getName());
    }
}
