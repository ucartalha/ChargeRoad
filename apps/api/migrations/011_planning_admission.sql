-- Stateless execution admission only. No location, account, trip or feedback data.
CREATE TABLE planning_admission_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  capacity smallint NOT NULL CHECK(capacity BETWEEN 1 AND 64)
);
INSERT INTO planning_admission_config(singleton,capacity) VALUES(true,4);
CREATE TABLE planning_execution_slots (
  slot_id smallint PRIMARY KEY CHECK(slot_id BETWEEN 1 AND 64),
  token uuid,
  expires_at timestamptz,
  CHECK((token IS NULL)=(expires_at IS NULL))
);
INSERT INTO planning_execution_slots(slot_id) SELECT generate_series(1,64);
