-- Client staff requests in full (12.1) and timesheet disputes with the manager's decision (12.2).

ALTER TABLE staff_request
    ADD COLUMN template_ids      uuid[]      NOT NULL DEFAULT '{}',
    ADD COLUMN competence_ids    uuid[]      NOT NULL DEFAULT '{}',
    ADD COLUMN experienced_only  boolean     NOT NULL DEFAULT false,
    ADD COLUMN client_ref        text,
    ADD COLUMN comment           text,
    ADD COLUMN contact_name      text        NOT NULL DEFAULT '',
    ADD COLUMN created_by        uuid,
    ADD COLUMN created_by_name   text        NOT NULL DEFAULT '',
    ADD COLUMN accepted_at       timestamptz,
    ADD COLUMN accepted_by       uuid,
    ADD COLUMN accepted_by_name  text,
    ADD COLUMN cancelled_at      timestamptz,
    ADD COLUMN cancelled_by      uuid,
    ADD COLUMN cancelled_by_name text,
    ADD COLUMN cancel_reason     text;
ALTER TABLE staff_request ADD CONSTRAINT staff_request_status_check
    CHECK (status IN ('draft', 'new', 'in_progress', 'staffed', 'done', 'cancelled'));

-- Shift days of an accepted request: `needed` places were added to the plan of each.
CREATE TABLE staff_request_cell (
    tenant_id   uuid    NOT NULL REFERENCES tenant (id),
    request_id  uuid    NOT NULL REFERENCES staff_request (id) ON DELETE CASCADE,
    template_id uuid    NOT NULL REFERENCES shift_template (id),
    date        date    NOT NULL,
    needed      integer NOT NULL CHECK (needed > 0),
    PRIMARY KEY (request_id, template_id, date)
);
CREATE INDEX staff_request_cell_shift_idx ON staff_request_cell (tenant_id, template_id, date);

-- Assignments counted towards a request (made in its cells after it was accepted).
CREATE TABLE staff_request_assignment (
    tenant_id     uuid NOT NULL REFERENCES tenant (id),
    request_id    uuid NOT NULL REFERENCES staff_request (id) ON DELETE CASCADE,
    assignment_id uuid NOT NULL REFERENCES assignment (id),
    PRIMARY KEY (request_id, assignment_id)
);
CREATE UNIQUE INDEX staff_request_assignment_once ON staff_request_assignment (assignment_id);

CREATE TABLE timesheet_dispute (
    id                uuid PRIMARY KEY,
    tenant_id         uuid          NOT NULL REFERENCES tenant (id),
    timesheet_id      uuid          NOT NULL REFERENCES timesheet (id) ON DELETE CASCADE,
    entry_id          uuid          NOT NULL REFERENCES timesheet_entry (id) ON DELETE CASCADE,
    reason_id         uuid          NOT NULL REFERENCES reason (id),
    client_hours      numeric(5, 2),
    comment           text          NOT NULL,
    created_at        timestamptz   NOT NULL,
    created_by        uuid,
    created_by_name   text          NOT NULL,
    status            text          NOT NULL CHECK (status IN ('open', 'agreed', 'rejected')),
    resolution_comment text,
    resolved_by       uuid,
    resolved_by_name  text,
    resolved_at       timestamptz,
    payable_after     numeric(5, 2),
    billable_after    numeric(5, 2),
    version           integer       NOT NULL DEFAULT 0
);
CREATE INDEX timesheet_dispute_ts_idx ON timesheet_dispute (tenant_id, timesheet_id);
-- At most one open dispute per timesheet day.
CREATE UNIQUE INDEX timesheet_dispute_open_uq ON timesheet_dispute (entry_id) WHERE status = 'open';

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['staff_request_cell', 'staff_request_assignment', 'timesheet_dispute']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kadreo_app', t);
    END LOOP;
END
$$;

-- New permissions: accept / cancel client requests, decide on timesheet disputes.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
CROSS JOIN (VALUES ('staffrequest.manage'), ('timesheet.dispute.resolve')) AS p (permission)
WHERE r.tenant_id IS NULL AND r.code IN ('OPS_MANAGER', 'SITE_MANAGER');
