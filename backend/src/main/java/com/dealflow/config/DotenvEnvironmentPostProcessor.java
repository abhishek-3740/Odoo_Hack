package com.dealflow.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;

/**
 * Loads a local {@code .env} file, which the README documents as the way to
 * configure this service. Spring Boot has no native {@code .env} support, so
 * without this the documented workflow silently does nothing and startup fails
 * on the "configure exactly one verification mode" check.
 *
 * <p>Two deliberate choices:
 *
 * <ul>
 *   <li>The source is registered <em>last</em>, so a real environment variable,
 *       a {@code -D} system property or a command-line argument always wins. A
 *       developer's file must never override what a deployment sets.</li>
 *   <li>It is a {@link SystemEnvironmentPropertySource} whose name ends in
 *       {@code -systemEnvironment}, which is what makes Spring Boot apply
 *       environment-variable relaxed binding to it. That is the only reason
 *       {@code SPRING_DATASOURCE_URL=...} in the file binds to
 *       {@code spring.datasource.url}; a plain properties source would not.</li>
 * </ul>
 *
 * <p>The file is optional and never required. It is git-ignored, and nothing
 * here logs a value.
 */
public class DotenvEnvironmentPostProcessor implements EnvironmentPostProcessor {

    /** The suffix is required for relaxed binding; see the class comment. */
    private static final String SOURCE_NAME = "dotenv-systemEnvironment";

    private static final List<String> CANDIDATES = List.of(".env", "backend/.env", "../backend/.env");

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        if (environment.getPropertySources().contains(SOURCE_NAME)) {
            return;
        }
        for (String candidate : CANDIDATES) {
            Path path = Path.of(candidate);
            if (!Files.isRegularFile(path)) {
                continue;
            }
            Map<String, Object> values = read(path);
            if (!values.isEmpty()) {
                environment.getPropertySources()
                        .addLast(new SystemEnvironmentPropertySource(SOURCE_NAME, values));
            }
            return;
        }
    }

    private static Map<String, Object> read(Path path) {
        Map<String, Object> values = new LinkedHashMap<>();
        List<String> lines;
        try {
            lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            // An unreadable .env is not a reason to refuse to start: every value
            // in it can also come from the real environment.
            return values;
        }
        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) {
                continue;
            }
            if (line.startsWith("export ")) {
                line = line.substring(7).strip();
            }
            int separator = line.indexOf('=');
            if (separator <= 0) {
                continue;
            }
            String key = line.substring(0, separator).strip();
            String value = unquote(line.substring(separator + 1).strip());
            if (!key.isEmpty()) {
                values.put(key, value);
            }
        }
        return values;
    }

    /** Strips one matching pair of surrounding quotes; leaves inner quotes alone. */
    private static String unquote(String value) {
        if (value.length() >= 2
                && ((value.startsWith("\"") && value.endsWith("\""))
                        || (value.startsWith("'") && value.endsWith("'")))) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }
}
