-- Up Migration
CREATE TABLE workflows (
  id          uuid        PRIMARY KEY,
  tenant_id   text        NOT NULL,
  def_name    text        NOT NULL,
  def_version int         NOT NULL,
  status      text        NOT NULL
    CHECK (status IN ('ready','running','suspended','completed','dead_lettered','cancelled')),
  phase_idx   int         NOT NULL DEFAULT 0,
  step_seq    int         NOT NULL DEFAULT 0,
  state       jsonb       NOT NULL,
  run_after   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflows_status_run_after_idx ON workflows (status, run_after);

CREATE TABLE workflow_events (
  workflow_id uuid        NOT NULL REFERENCES workflows(id),
  seq         int         NOT NULL,
  type        text        NOT NULL,
  payload     jsonb       NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, seq)
);

-- Down Migration
DROP TABLE workflow_events;
DROP TABLE workflows;
