/**
 * Operations (spec 11.1): the live dashboard, alerts with escalation, client staff requests,
 * urgent replacement requests, notifications, global search and menu counters.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {"platform", "organization", "workforce", "timetracking"})
package com.kadreo.operations;
