ALTER TABLE "conventions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_start_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_end_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;