package com.kadreo;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/** Module boundaries (spec 5.1 p. 1): no module reaches into another module's internals. */
class ModularityTests {

    @Test
    void modulesRespectTheirBoundaries() {
        ApplicationModules.of(KadreoApplication.class).verify();
    }
}
