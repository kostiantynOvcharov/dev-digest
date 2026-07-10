CREATE TABLE "pr_diff_summary" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"json" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_diff_summary" ADD CONSTRAINT "pr_diff_summary_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;