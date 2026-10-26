-- Transactional outbox (spec 5.1 p. 2): Spring Modulith stores every domain event published in a
-- transaction here, in the same transaction, and marks it complete once each listener succeeds.
-- Infrastructure table: no tenant column, the serialized event carries its own tenant id.
CREATE TABLE IF NOT EXISTS event_publication (
    id               uuid                     NOT NULL PRIMARY KEY,
    listener_id      text                     NOT NULL,
    event_type       text                     NOT NULL,
    serialized_event text                     NOT NULL,
    publication_date timestamp with time zone NOT NULL,
    completion_date  timestamp with time zone
);
CREATE INDEX IF NOT EXISTS event_publication_serialized_event_hash_idx ON event_publication USING hash (serialized_event);
CREATE INDEX IF NOT EXISTS event_publication_by_completion_date_idx ON event_publication (completion_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_publication TO kadreo_app;
