-- Mobile app and site kiosk (spec 14): worker accounts, clock-in rules and approvals, problem
-- reports, urgent offers to workers, shift output, kiosk devices and worker kiosk credentials.

-- A worker's app account (WORKER, TEAM_LEADER) is linked to their worker record.
ALTER TABLE app_user ADD COLUMN worker_id uuid REFERENCES worker (id);
CREATE UNIQUE INDEX app_user_worker_uq ON app_user (tenant_id, worker_id) WHERE worker_id IS NOT NULL;

-- Site settings of 14.1–14.2 and the output norm of section 15.
ALTER TABLE site
    ADD COLUMN no_show_after_min integer NOT NULL DEFAULT 10,
    ADD COLUMN geofence_radius_m integer NOT NULL DEFAULT 150,
    ADD COLUMN required_accuracy_m integer NOT NULL DEFAULT 100,
    ADD COLUMN output_norm integer,
    ADD COLUMN output_unit text,
    ADD COLUMN output_source text CHECK (output_source IN ('team_leader', 'client'));

-- Clock events get a status: flagged (outside the geofence with a comment), pending (manual,
-- waits for SITE_MANAGER — four eyes, section 3), rejected; plus the proof and who decided.
ALTER TABLE clock_event
    ADD COLUMN status          text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'flagged', 'pending', 'rejected')),
    ADD COLUMN lat             double precision,
    ADD COLUMN lng             double precision,
    ADD COLUMN distance_m      integer,
    ADD COLUMN comment         text,
    ADD COLUMN manual_reason   text,
    ADD COLUMN created_by      uuid,
    ADD COLUMN created_by_name text,
    ADD COLUMN decided_by      uuid,
    ADD COLUMN decided_by_name text,
    ADD COLUMN decided_at      timestamptz,
    ADD COLUMN decision_reason text,
    ADD COLUMN kiosk_device_id uuid,
    -- Arrival order: breaks recorded within the same second keep their order.
    ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY,
    -- When it happened: the device's time for offline and manual records, else the server's.
    ADD COLUMN at timestamptz GENERATED ALWAYS AS (CASE WHEN offline OR source = 'manual' THEN device_time ELSE server_time END) STORED;
CREATE INDEX clock_event_assignment_idx ON clock_event (tenant_id, assignment_id, at);
CREATE INDEX clock_event_pending_idx ON clock_event (tenant_id, status) WHERE status = 'pending';

-- «Проблема с отметкой» and «Опаздываю» from the worker (14.1-11, 14.2-08).
CREATE TABLE clock_issue (
    id              uuid PRIMARY KEY,
    tenant_id       uuid        NOT NULL REFERENCES tenant (id),
    worker_id       uuid        NOT NULL REFERENCES worker (id),
    assignment_id   uuid        NOT NULL REFERENCES assignment (id),
    kind            text        NOT NULL CHECK (kind IN ('no_gps', 'no_camera', 'forgot', 'other', 'late')),
    type            text        NOT NULL CHECK (type IN ('in', 'break_start', 'break_end', 'out')),
    local_time      time        NOT NULL,
    comment         text        NOT NULL DEFAULT '' CHECK (length(comment) <= 500),
    status          text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    created_by_name text        NOT NULL,
    decided_by      uuid,
    decided_by_name text,
    decided_at      timestamptz,
    decision_reason text,
    clock_event_id  uuid REFERENCES clock_event (id)
);
CREATE INDEX clock_issue_open_idx ON clock_issue (tenant_id, status, assignment_id);

-- Urgent offers to individual workers (11.1-06, 14.3-05): the first to accept gets the place.
ALTER TABLE urgent_request
    ADD COLUMN replaces_id  uuid REFERENCES assignment (id),
    ADD COLUMN bonus_points integer NOT NULL DEFAULT 0,
    ADD COLUMN closed_at    timestamptz;
CREATE TABLE urgent_offer (
    id            uuid PRIMARY KEY,
    tenant_id     uuid        NOT NULL REFERENCES tenant (id),
    request_id    uuid        NOT NULL REFERENCES urgent_request (id),
    worker_id     uuid        NOT NULL REFERENCES worker (id),
    status        text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'declined', 'closed')),
    sent_at       timestamptz NOT NULL DEFAULT now(),
    responded_at  timestamptz,
    assignment_id uuid REFERENCES assignment (id),
    UNIQUE (request_id, worker_id)
);
CREATE INDEX urgent_offer_worker_idx ON urgent_offer (tenant_id, worker_id, status);

-- Output of one shift of a site (14.2-10), entered by the team leader.
CREATE TABLE shift_output (
    tenant_id       uuid        NOT NULL REFERENCES tenant (id),
    site_id         uuid        NOT NULL REFERENCES site (id),
    date            date        NOT NULL,
    start_time      time        NOT NULL,
    value           integer     NOT NULL CHECK (value >= 0),
    updated_at      timestamptz NOT NULL,
    updated_by      uuid,
    PRIMARY KEY (site_id, date, start_time)
);

-- Kiosk devices (14.4): one KIOSK account per tablet, bound to a site and an entry point.
CREATE TABLE kiosk_device (
    id           uuid PRIMARY KEY,
    tenant_id    uuid        NOT NULL REFERENCES tenant (id),
    user_id      uuid        NOT NULL UNIQUE REFERENCES app_user (id),
    site_id      uuid        NOT NULL REFERENCES site (id),
    code         text        NOT NULL,
    entry        text        NOT NULL,
    face_enabled boolean     NOT NULL DEFAULT false,
    last_seen_at timestamptz,
    UNIQUE (tenant_id, code)
);

-- Kiosk credentials of a worker: PIN (hash only), card UID, biometric consent (7.4).
CREATE TABLE worker_credential (
    tenant_id            uuid NOT NULL REFERENCES tenant (id),
    worker_id            uuid PRIMARY KEY REFERENCES worker (id),
    pin_hash             text,
    pin_failed           integer NOT NULL DEFAULT 0,
    pin_locked_until     timestamptz,
    card_uid             text,
    biometric_consent_at timestamptz,
    UNIQUE (tenant_id, card_uid)
);

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['clock_issue', 'urgent_offer', 'shift_output', 'kiosk_device', 'worker_credential']
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kadreo_app', t);
    END LOOP;
END
$$;

-- clockevent.self: own clock-ins in the app (WORKER, and TEAM_LEADER who is a worker too);
-- clockevent.manual.create: manual clock-ins for the brigade; clockevent.manual.approve: four eyes;
-- output.record: shift output; kiosk.clock: the kiosk device account.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
        ('WORKER', 'clockevent.self'),
        ('TEAM_LEADER', 'clockevent.self'), ('TEAM_LEADER', 'clockevent.manual.create'), ('TEAM_LEADER', 'output.record'), ('TEAM_LEADER', 'team.read'),
        ('SITE_MANAGER', 'clockevent.manual.approve'), ('OPS_MANAGER', 'clockevent.manual.approve'),
        ('KIOSK', 'kiosk.clock')) AS p (role_code, permission)
    ON p.role_code = r.code
WHERE r.tenant_id IS NULL
ON CONFLICT DO NOTHING;
