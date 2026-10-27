-- Hours of a day from clock events (spec 9.2 «Как считаются часы дня»): contract rules for
-- rounding and paid breaks; an entry remembers when it was last computed from the events.
ALTER TABLE contract
    ADD COLUMN rounding_minutes integer NOT NULL DEFAULT 15 CHECK (rounding_minutes IN (1, 5, 6, 10, 15, 30)),
    ADD COLUMN paid_breaks      boolean NOT NULL DEFAULT false;

ALTER TABLE timesheet_entry
    ADD COLUMN computed_at timestamptz;
