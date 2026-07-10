CREATE TABLE "agent_context_docs" (
	"agent_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_context_docs_agent_id_path_pk" PRIMARY KEY("agent_id","path")
);
--> statement-breakpoint
CREATE TABLE "repo_context_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"size_bytes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_context_index_state" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"last_indexed_at" timestamp with time zone,
	"files_indexed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_context_docs" (
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_context_docs_skill_id_path_pk" PRIMARY KEY("skill_id","path")
);
--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_context_docs" ADD CONSTRAINT "repo_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_context_index_state" ADD CONSTRAINT "repo_context_index_state_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_context_docs_repo_idx" ON "repo_context_docs" USING btree ("repo_id");