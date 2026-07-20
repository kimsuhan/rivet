CREATE TYPE "WorkflowStateColor" AS ENUM (
  'GRAY',
  'COOL_GRAY',
  'INDIGO',
  'TEAL',
  'GREEN',
  'YELLOW',
  'ORANGE',
  'BROWN',
  'RED'
);

ALTER TABLE "workflow_states"
ADD COLUMN "color" "WorkflowStateColor";
