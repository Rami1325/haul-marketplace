CREATE TYPE "public"."adjustment_reason" AS ENUM('added_stop', 'unlisted_items', 'excess_waiting', 'late_reschedule');--> statement-breakpoint
CREATE TYPE "public"."adjustment_status" AS ENUM('proposed', 'approved', 'rejected', 'applied');--> statement-breakpoint
CREATE TYPE "public"."authorization_status" AS ENUM('active', 'captured', 'partially_captured', 'voided', 'expired', 'declined');--> statement-breakpoint
CREATE TYPE "public"."crane_need" AS ENUM('not_needed', 'recommended', 'required', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'investigating', 'resolved_refund', 'resolved_rejected', 'resolved_goodwill');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('national_id', 'liveness_selfie', 'driving_licence', 'vehicle_registration', 'compulsory_insurance', 'third_party_insurance', 'goods_in_transit_insurance', 'police_clearance', 'vehicle_photos', 'bank_confirmation', 'tax_registration');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('missing', 'submitted', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('onboarding', 'pending_review', 'active', 'suspended', 'banned', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."elevator_kind" AS ENUM('none', 'small', 'standard', 'service');--> statement-breakpoint
CREATE TYPE "public"."item_category" AS ENUM('furniture', 'appliance', 'boxes', 'electronics', 'outdoor', 'fitness', 'special', 'other');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('quoted', 'expired', 'scheduled', 'matching', 'accepted', 'en_route', 'loading', 'driving', 'unloading', 'completed', 'settled', 'no_match', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('customer_receivable', 'psp_clearing', 'bank_account', 'platform_revenue', 'driver_payable', 'vat_payable', 'payment_fees', 'promo_expense', 'driver_incentive_expense', 'tip_payable', 'claims_expense', 'refund_expense');--> statement-breakpoint
CREATE TYPE "public"."ledger_event_kind" AS ENUM('authorization', 'authorization_released', 'capture', 'psp_deposit', 'cancellation_fee', 'refund', 'driver_payout', 'tip', 'promo', 'incentive', 'claim', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('he', 'en');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."parking_situation" AS ENUM('driveway', 'street_easy', 'street_hard', 'paid_lot', 'none');--> statement-breakpoint
CREATE TYPE "public"."payout_batch_status" AS ENUM('draft', 'exported', 'submitted', 'settled', 'partially_failed');--> statement-breakpoint
CREATE TYPE "public"."payout_line_status" AS ENUM('pending', 'paid', 'failed', 'withheld');--> statement-breakpoint
CREATE TYPE "public"."proof_photo_kind" AS ENUM('load', 'unload', 'issue');--> statement-breakpoint
CREATE TYPE "public"."schedule_kind" AS ENUM('now', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."stop_kind" AS ENUM('pickup', 'dropoff');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'driver', 'ops', 'admin');--> statement-breakpoint
CREATE TYPE "public"."vehicle_class" AS ENUM('pickup', 'small_van', 'van', 'box_truck_4t', 'box_truck_8t', 'crane_truck');--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"driver_id" varchar(64) NOT NULL,
	"kind" "document_kind" NOT NULL,
	"status" "document_status" DEFAULT 'missing' NOT NULL,
	"file_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" varchar(64),
	"expires_at" timestamp with time zone,
	"rejection_reason_he" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"city_id" varchar(64) NOT NULL,
	"status" "driver_status" DEFAULT 'onboarding' NOT NULL,
	"photo_url" varchar(500),
	"bio_he" text,
	"home_latitude" double precision,
	"home_longitude" double precision,
	"rating" real DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"acceptance_rate" real DEFAULT 0 NOT NULL,
	"completion_rate" real DEFAULT 0 NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payout_account_id" varchar(120),
	"payout_account_ready" boolean DEFAULT false NOT NULL,
	"bank_details" jsonb,
	"approved_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspension_reason_he" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_addresses" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"label" varchar(80),
	"street" varchar(200) NOT NULL,
	"house_number" varchar(20) NOT NULL,
	"entrance" varchar(20),
	"apartment" varchar(20),
	"city" varchar(120) NOT NULL,
	"postal_code" varchar(10),
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"place_id" varchar(300),
	"formatted" varchar(500) NOT NULL,
	"notes" text,
	"default_access" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"phone" varchar(20) NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"first_name" varchar(80),
	"last_name" varchar(80),
	"email" varchar(200),
	"locale" "locale" DEFAULT 'he' NOT NULL,
	"risk_score" real DEFAULT 0 NOT NULL,
	"cancelled_job_count" integer DEFAULT 0 NOT NULL,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"driver_id" varchar(64) NOT NULL,
	"class_id" "vehicle_class" NOT NULL,
	"plate_number" varchar(15) NOT NULL,
	"make" varchar(60),
	"model" varchar(60),
	"year" integer,
	"colour" varchar(40),
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_crane" boolean DEFAULT false NOT NULL,
	"has_tail_lift" boolean DEFAULT false NOT NULL,
	"has_blankets" boolean DEFAULT true NOT NULL,
	"has_straps" boolean DEFAULT true NOT NULL,
	"has_trolley" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"reason" "adjustment_reason" NOT NULL,
	"status" "adjustment_status" DEFAULT 'proposed' NOT NULL,
	"lines" jsonb NOT NULL,
	"delta_gross" bigint NOT NULL,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note_he" text,
	"proposed_by" varchar(20) NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"payment_authorization_id" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_location_trail" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"driver_id" varchar(64) NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_meters" real,
	"speed_kph" real,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_manifest_lines" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"catalog_item_id" varchar(64) NOT NULL,
	"quantity" smallint NOT NULL,
	"custom_label" varchar(200),
	"stop_index" smallint DEFAULT 0 NOT NULL,
	"added_during_job" boolean DEFAULT false NOT NULL,
	"loaded_at" timestamp with time zone,
	"unloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_stops" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"stop_index" smallint NOT NULL,
	"kind" "stop_kind" NOT NULL,
	"street" varchar(200) NOT NULL,
	"house_number" varchar(20) NOT NULL,
	"entrance" varchar(20),
	"apartment" varchar(20),
	"city" varchar(120) NOT NULL,
	"postal_code" varchar(10),
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"place_id" varchar(300),
	"formatted" varchar(500) NOT NULL,
	"address_notes" text,
	"contact_name" varchar(120),
	"contact_phone" varchar(20),
	"floor" smallint NOT NULL,
	"elevator" "elevator_kind" NOT NULL,
	"stair_flights" smallint DEFAULT 0 NOT NULL,
	"carry_distance_meters" integer DEFAULT 0 NOT NULL,
	"parking" "parking_situation" NOT NULL,
	"narrow_stairwell" boolean DEFAULT false NOT NULL,
	"crane" "crane_need" DEFAULT 'unknown' NOT NULL,
	"permit_required" boolean DEFAULT false NOT NULL,
	"access_notes" text,
	"arrived_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"reference" varchar(20) NOT NULL,
	"state" "job_state" DEFAULT 'quoted' NOT NULL,
	"city_id" varchar(64) NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"driver_id" varchar(64),
	"vehicle_id" varchar(64),
	"vehicle_class_id" "vehicle_class" NOT NULL,
	"crew_size" smallint NOT NULL,
	"schedule_kind" "schedule_kind" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"completion_pin" varchar(12),
	"signature_url" varchar(500),
	"tip_amount" bigint DEFAULT 0 NOT NULL,
	"cancelled_by" varchar(20),
	"cancelled_at" timestamp with time zone,
	"cancellation_reason_code" varchar(64),
	"cancellation_reason_text" text,
	"cancelled_after_driver_committed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booked_at" timestamp with time zone,
	"dispatch_opened_at" timestamp with time zone,
	"matched_at" timestamp with time zone,
	"en_route_at" timestamp with time zone,
	"arrived_pickup_at" timestamp with time zone,
	"loaded_at" timestamp with time zone,
	"arrived_dropoff_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"estimated_working_minutes" integer NOT NULL,
	"actual_working_minutes" integer,
	"routed_distance_meters" integer NOT NULL,
	"ops_intervention_count" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_photos" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"kind" "proof_photo_kind" NOT NULL,
	"url" varchar(500) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"captured_latitude" double precision,
	"captured_longitude" double precision,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" varchar(128),
	"stop_index" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64),
	"city_id" varchar(64) NOT NULL,
	"breakdown" jsonb NOT NULL,
	"locked_total" bigint NOT NULL,
	"driver_payout" bigint NOT NULL,
	"promo_amount_gross" bigint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"estimated_working_minutes" integer NOT NULL,
	"recommended_vehicle_class" "vehicle_class" NOT NULL,
	"crew_size" smallint NOT NULL,
	"routed_distance_meters" integer NOT NULL,
	"engine_version" varchar(32) NOT NULL,
	"rate_card_version" varchar(32) NOT NULL,
	"input_hash" varchar(128) NOT NULL,
	"pricing_input" jsonb NOT NULL,
	"reviewed_by" varchar(64),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"subject" varchar(20) NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_waves" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"wave" smallint NOT NULL,
	"radius_meters" integer NOT NULL,
	"eligible_pool_size" integer NOT NULL,
	"offers_sent" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"succeeded" boolean DEFAULT false NOT NULL,
	"escalated_to_ops" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_presence" (
	"driver_id" varchar(64) PRIMARY KEY NOT NULL,
	"city_id" varchar(64) NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"is_busy" boolean DEFAULT false NOT NULL,
	"current_job_id" varchar(64),
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_meters" real,
	"heading_degrees" real,
	"active_vehicle_id" varchar(64),
	"active_vehicle_class" "vehicle_class",
	"last_offer_at" timestamp with time zone,
	"last_job_completed_at" timestamp with time zone,
	"went_online_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"driver_id" varchar(64) NOT NULL,
	"wave" smallint NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"payout" bigint NOT NULL,
	"payout_boost" bigint DEFAULT 0 NOT NULL,
	"distance_to_pickup_meters" integer NOT NULL,
	"eta_to_pickup_seconds" integer NOT NULL,
	"score" real,
	"score_breakdown" jsonb,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"decline_reason" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"raised_by" varchar(20) NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"category" varchar(64) NOT NULL,
	"description_he" text NOT NULL,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claimed_amount" bigint,
	"resolved_amount" bigint,
	"driver_debit_amount" bigint,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar(64),
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"transaction_id" varchar(64) NOT NULL,
	"account" "ledger_account" NOT NULL,
	"amount" bigint NOT NULL,
	"memo" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"kind" "ledger_event_kind" NOT NULL,
	"job_id" varchar(64),
	"driver_id" varchar(64),
	"customer_id" varchar(64),
	"external_ref" varchar(200),
	"idempotency_key" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_authorizations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"customer_id" varchar(64) NOT NULL,
	"provider_id" varchar(40) NOT NULL,
	"provider_ref" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"amount" bigint NOT NULL,
	"captured_amount" bigint DEFAULT 0 NOT NULL,
	"status" "authorization_status" DEFAULT 'active' NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approval_number" varchar(64),
	"decline_reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"city_id" varchar(64) NOT NULL,
	"status" "payout_batch_status" DEFAULT 'draft' NOT NULL,
	"total_amount" bigint NOT NULL,
	"line_count" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"exported_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"bank_reference" varchar(120),
	"submitted_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_lines" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"batch_id" varchar(64) NOT NULL,
	"driver_id" varchar(64) NOT NULL,
	"amount" bigint NOT NULL,
	"job_ids" jsonb NOT NULL,
	"bank_snapshot" jsonb NOT NULL,
	"status" "payout_line_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"actor_id" varchar(64),
	"actor_role" varchar(20) NOT NULL,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" varchar(64),
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip_address" varchar(64),
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name_he" varchar(120) NOT NULL,
	"name_en" varchar(120) NOT NULL,
	"locale" "locale" DEFAULT 'he' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Jerusalem' NOT NULL,
	"centre_latitude" double precision NOT NULL,
	"centre_longitude" double precision NOT NULL,
	"service_radius_meters" integer NOT NULL,
	"candle_lighting_minutes" smallint DEFAULT 18 NOT NULL,
	"nightfall_minutes" smallint DEFAULT 40 NOT NULL,
	"operating_start_hour" smallint DEFAULT 7 NOT NULL,
	"operating_end_hour" smallint DEFAULT 22 NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"rollout_percent" smallint DEFAULT 0 NOT NULL,
	"city_id" varchar(64),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" varchar(64) NOT NULL,
	"signal" varchar(64) NOT NULL,
	"severity" smallint DEFAULT 1 NOT NULL,
	"detail" jsonb,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" varchar(64),
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"promo_id" varchar(64) NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"job_id" varchar(64) NOT NULL,
	"amount_applied" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"code" varchar(40) NOT NULL,
	"city_id" varchar(64),
	"amount_off" bigint,
	"percent_off_bps" integer,
	"max_discount" bigint,
	"min_job_value" bigint,
	"first_job_only" boolean DEFAULT false NOT NULL,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"max_per_customer" smallint DEFAULT 1 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"city_id" varchar(64) NOT NULL,
	"version" varchar(32) NOT NULL,
	"card" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_by" varchar(64),
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_location_trail" ADD CONSTRAINT "job_location_trail_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_manifest_lines" ADD CONSTRAINT "job_manifest_lines_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stops" ADD CONSTRAINT "job_stops_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof_photos" ADD CONSTRAINT "proof_photos_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_waves" ADD CONSTRAINT "dispatch_waves_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_active_vehicle_id_vehicles_id_fk" FOREIGN KEY ("active_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_lines" ADD CONSTRAINT "payout_lines_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "driver_documents_driver_kind_key" ON "driver_documents" USING btree ("driver_id","kind");--> statement-breakpoint
CREATE INDEX "driver_documents_expiry_idx" ON "driver_documents" USING btree ("expires_at") WHERE expires_at is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_key" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drivers_city_status_idx" ON "drivers" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "saved_addresses_user_idx" ON "saved_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles" USING btree ("plate_number");--> statement-breakpoint
CREATE INDEX "vehicles_driver_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "adjustments_job_idx" ON "adjustments" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "adjustments_pending_idx" ON "adjustments" USING btree ("job_id") WHERE status = 'proposed';--> statement-breakpoint
CREATE INDEX "job_location_trail_job_time_idx" ON "job_location_trail" USING btree ("job_id","recorded_at");--> statement-breakpoint
CREATE INDEX "job_manifest_lines_job_idx" ON "job_manifest_lines" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_stops_job_index_key" ON "job_stops" USING btree ("job_id","stop_index");--> statement-breakpoint
CREATE INDEX "job_stops_job_idx" ON "job_stops" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_reference_key" ON "jobs" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "jobs_city_state_idx" ON "jobs" USING btree ("city_id","state","created_at");--> statement-breakpoint
CREATE INDEX "jobs_customer_idx" ON "jobs" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_driver_idx" ON "jobs" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_scheduled_window_idx" ON "jobs" USING btree ("window_start") WHERE state = 'scheduled';--> statement-breakpoint
CREATE INDEX "proof_photos_job_kind_idx" ON "proof_photos" USING btree ("job_id","kind");--> statement-breakpoint
CREATE INDEX "quotes_job_idx" ON "quotes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "quotes_hash_idx" ON "quotes" USING btree ("input_hash");--> statement-breakpoint
CREATE INDEX "quotes_ratecard_idx" ON "quotes" USING btree ("rate_card_version","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_job_subject_key" ON "ratings" USING btree ("job_id","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_waves_job_wave_key" ON "dispatch_waves" USING btree ("job_id","wave");--> statement-breakpoint
CREATE INDEX "driver_presence_available_idx" ON "driver_presence" USING btree ("city_id","updated_at") WHERE is_online = true and is_busy = false;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_job_driver_wave_key" ON "offers" USING btree ("job_id","driver_id","wave");--> statement-breakpoint
CREATE INDEX "offers_driver_idx" ON "offers" USING btree ("driver_id","offered_at");--> statement-breakpoint
CREATE INDEX "offers_live_idx" ON "offers" USING btree ("expires_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "disputes_job_idx" ON "disputes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "disputes_open_idx" ON "disputes" USING btree ("due_at") WHERE status in ('open', 'investigating');--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_job_idx" ON "ledger_transactions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_driver_idx" ON "ledger_transactions" USING btree ("driver_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_transactions_kind_time_idx" ON "ledger_transactions" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE INDEX "payment_authorizations_job_idx" ON "payment_authorizations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "payment_authorizations_expiry_idx" ON "payment_authorizations" USING btree ("expires_at") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "payout_lines_batch_driver_key" ON "payout_lines" USING btree ("batch_id","driver_id");--> statement-breakpoint
CREATE INDEX "payout_lines_driver_idx" ON "payout_lines" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "fraud_flags_subject_idx" ON "fraud_flags" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "fraud_flags_open_idx" ON "fraud_flags" USING btree ("created_at") WHERE reviewed_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_promo_job_key" ON "promo_redemptions" USING btree ("promo_id","job_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_user_idx" ON "promo_redemptions" USING btree ("user_id","promo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promos_code_key" ON "promos" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_city_version_key" ON "rate_cards" USING btree ("city_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_cards_city_current_key" ON "rate_cards" USING btree ("city_id") WHERE effective_until is null;