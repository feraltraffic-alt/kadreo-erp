/**
 * Client Portal (spec 2.4, 12): what a client's staff see and do — overview, staff requests,
 * hours to confirm or dispute. Every query is limited to the signed-in user's client; billable
 * hours only, never payroll or other clients' data.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {"platform", "organization", "workforce", "timetracking", "operations"})
package com.kadreo.portal;
