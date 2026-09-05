package com.dealflow.config;

import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.ToStringSerializer;
import java.math.BigDecimal;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class JacksonConfig {

    /**
     * Money and quantities cross the wire as decimal STRINGS.
     *
     * <p>JSON numbers are IEEE-754 doubles in every browser. Sending
     * {@code 39300.10} as a number and reading it back can produce
     * {@code 39300.099999999999}, and a total that does not match its lines is
     * worse than a slightly noisier payload. Serialising {@link BigDecimal} as a
     * string removes the failure mode entirely.
     */
    @Bean
    public SimpleModule exactDecimalModule() {
        SimpleModule module = new SimpleModule("dealflow-exact-decimals");
        module.addSerializer(BigDecimal.class, ToStringSerializer.instance);
        return module;
    }
}
