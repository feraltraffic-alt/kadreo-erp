/**
 * Time &amp; Attendance (spec 2.1, 9.2): clock events with their evidence, timesheets built from
 * them, corrections with reasons, sending to the client for confirmation.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {"platform", "organization", "workforce"})
package com.kadreo.timetracking;
