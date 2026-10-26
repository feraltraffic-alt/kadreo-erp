-- Client portal (spec 12): client users, client confirmation of timesheet days.

-- A client user belongs to exactly one client and works only in the portal API.
ALTER TABLE app_user ADD COLUMN client_id uuid REFERENCES client (id);
CREATE INDEX app_user_client_idx ON app_user (tenant_id, client_id) WHERE client_id IS NOT NULL;

-- 12.2-15: confirmed days do not change any more; who, when and from which IP is in the audit log.
ALTER TABLE timesheet_entry ADD COLUMN client_confirmed_at timestamptz;
ALTER TABLE timesheet
    ADD COLUMN confirmed_at      timestamptz,
    ADD COLUMN confirmed_by      uuid,
    ADD COLUMN confirmed_by_name text;

-- Permissions of the client roles (portal.read: the portal at all; the rest per 12.1, 12.2).
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
        ('CLIENT_ADMIN', 'portal.read'), ('CLIENT_ADMIN', 'staffrequest.create'), ('CLIENT_ADMIN', 'timesheet.client.confirm'), ('CLIENT_ADMIN', 'client.users.manage'),
        ('CLIENT_MANAGER', 'portal.read'), ('CLIENT_MANAGER', 'staffrequest.create'), ('CLIENT_MANAGER', 'timesheet.client.confirm'),
        ('CLIENT_VIEWER', 'portal.read')) AS p (role_code, permission)
    ON p.role_code = r.code
WHERE r.tenant_id IS NULL
ON CONFLICT DO NOTHING;
