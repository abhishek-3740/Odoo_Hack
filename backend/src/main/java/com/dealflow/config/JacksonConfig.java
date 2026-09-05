package com.dealflow.config;

import java.math.BigDecimal;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.JsonGenerator;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

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
        module.addSerializer(BigDecimal.class, new ExactDecimalSerializer());
        return module;
    }

    /**
     * Writes a decimal as a plain string with one deliberate normalisation.
     *
     * <p>Money is always constructed at exactly scale 2 ({@code Money.toMajor}),
     * and that scale is meaningful: {@code "21000.00"} is the contract. Quantities
     * and percentages, by contrast, pick up a database scale on the way back —
     * {@code numeric(18,3)} turns the {@code 4} a client sent into {@code 4.000}.
     * So trailing zeros are stripped only when the scale is above 2, which
     * leaves every money value untouched and renders {@code 4.000} as
     * {@code 4} and {@code 1.500} as {@code 1.5}.
     */
    static final class ExactDecimalSerializer extends StdSerializer<BigDecimal> {

        ExactDecimalSerializer() {
            super(BigDecimal.class);
        }

        @Override
        public void serialize(BigDecimal value, JsonGenerator generator, SerializationContext context) {
            generator.writeString(com.dealflow.shared.money.Money.plainQuantity(value));
        }
    }
}
