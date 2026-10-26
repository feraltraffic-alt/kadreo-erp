/**
 * Mobile app and site kiosk (spec 14): the worker's clock-in screen and schedule, the team
 * leader's brigade, the manager's summary and decisions, and the kiosk at the site entrance.
 * Clock events belong to timetracking, offers to operations, assignments to workforce; this
 * module puts them together for the phone and the tablet.
 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {"platform", "organization", "workforce", "timetracking", "operations"})
package com.kadreo.mobile;
