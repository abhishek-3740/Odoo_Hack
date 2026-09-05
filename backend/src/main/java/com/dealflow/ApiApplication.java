package com.dealflow;

import java.util.TimeZone;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ApiApplication {
    static {
        // The JDBC driver sends the JVM's default zone as the connection's
        // TimeZone startup parameter. A Windows JVM reports the legacy alias
        // "Asia/Calcutta", and PostgreSQL 18 no longer ships the backward
        // -compatibility zone names, so such a connection is refused outright.
        //
        // The server has no business reading a wall clock from the host anyway:
        // timestamps are stored in UTC (spring.jpa hibernate.jdbc.time_zone) and
        // every business date is derived from app.billing.timezone. Pinning the
        // default makes that explicit and keeps the machine's locale out of it.
        // Honour an operator's explicit -Duser.timezone.
        if (System.getProperty("user.timezone", "").isBlank()) {
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        }
    }

    public static void main(String[] args) {
        SpringApplication.run(ApiApplication.class, args);
    }
}
