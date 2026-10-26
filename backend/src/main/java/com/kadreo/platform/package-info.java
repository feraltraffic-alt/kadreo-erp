/**
 * Shared kernel: tenant context and row-level security, authentication, permissions, error
 * model, ids and clock. Every other module may depend on it.
 */
@org.springframework.modulith.ApplicationModule(type = org.springframework.modulith.ApplicationModule.Type.OPEN)
package com.kadreo.platform;
