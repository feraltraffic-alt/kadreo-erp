-- Background jobs (timesheet auto-acceptance, later: escalations, document expiry) run without a
-- user and must visit every tenant. Row-level security hides all rows while app.tenant_id is
-- empty, so a job first lists tenant ids under this narrow, read-only policy, then processes each
-- tenant with app.tenant_id set as usual. The setting is transaction-local in the job code and
-- only opens the tenant table (ids and names), never business data.
CREATE POLICY tenant_system_scan ON tenant FOR SELECT
    USING (current_setting('app.system_job', true) = 'tenant-scan');

-- Auto-acceptance looks for sent timesheets whose client deadline has passed.
CREATE INDEX timesheet_waiting_due_idx ON timesheet (client_due_at) WHERE client_stage = 'waiting';
