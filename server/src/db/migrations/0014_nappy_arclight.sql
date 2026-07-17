ALTER TABLE "eval_runs" ADD COLUMN "run_group_id" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "system_prompt" text;--> statement-breakpoint
CREATE INDEX "eval_runs_run_group_id_idx" ON "eval_runs" USING btree ("run_group_id");