CREATE TABLE "booking_drafts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"session_token_hash" varchar(64) NOT NULL,
	"customer_id" varchar(64),
	"city_id" varchar(64) NOT NULL,
	"locale" "locale" DEFAULT 'he' NOT NULL,
	"version" smallint NOT NULL,
	"draft" jsonb NOT NULL,
	"job_id" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_drafts" ADD CONSTRAINT "booking_drafts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_drafts_session_key" ON "booking_drafts" USING btree ("session_token_hash") WHERE job_id is null;--> statement-breakpoint
CREATE INDEX "booking_drafts_customer_idx" ON "booking_drafts" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_drafts_open_idx" ON "booking_drafts" USING btree ("updated_at") WHERE job_id is null;--> statement-breakpoint
CREATE INDEX "booking_drafts_expiry_idx" ON "booking_drafts" USING btree ("expires_at") WHERE job_id is null;