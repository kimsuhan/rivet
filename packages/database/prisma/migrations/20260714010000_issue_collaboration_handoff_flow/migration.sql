ALTER TABLE "team_works"
  RENAME COLUMN "scope_note" TO "work_note_markdown";

ALTER TABLE "team_works"
  ALTER COLUMN "work_note_markdown" TYPE VARCHAR(10000);

DROP TABLE "team_work_relations";
