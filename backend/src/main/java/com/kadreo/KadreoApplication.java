package com.kadreo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Kadreo ERP back end: a modular monolith (spec 5). Each top-level package is a Spring Modulith
 * application module with its own tables; modules talk through public types and domain events,
 * and the module boundaries are verified by {@code ModularityTests}.
 */
@SpringBootApplication
@EnableScheduling
public class KadreoApplication {
    public static void main(String[] args) {
        SpringApplication.run(KadreoApplication.class, args);
    }
}
