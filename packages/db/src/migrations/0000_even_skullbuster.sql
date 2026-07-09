CREATE TYPE "public"."xhs_account_status" AS ENUM('not_configured', 'login_required', 'ready', 'expired', 'error');--> statement-breakpoint
CREATE TYPE "public"."xhs_task_log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."xhs_task_status" AS ENUM('created', 'validating', 'opening_browser', 'checking_login', 'uploading_media', 'filling_form', 'submitting', 'verifying_result', 'succeeded', 'failed', 'submitted_unknown');--> statement-breakpoint
CREATE TYPE "public"."xhs_visibility" AS ENUM('public', 'private', 'followers');--> statement-breakpoint
CREATE TABLE "account" (
	"access_token" text,
	"access_token_expires_at" timestamp,
	"account_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"id_token" text,
	"password" text,
	"provider_id" text NOT NULL,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"updated_at" timestamp NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"ip_address" text,
	"token" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xhs_account_config" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"display_name" text,
	"id" text PRIMARY KEY NOT NULL,
	"last_checked_at" timestamp,
	"last_login_at" timestamp,
	"profile_path" text,
	"status" "xhs_account_status" DEFAULT 'not_configured' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xhs_publish_task" (
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"debug_screenshot_path" text,
	"error_code" text,
	"error_message" text,
	"id" text PRIMARY KEY NOT NULL,
	"media" jsonb NOT NULL,
	"published_at" timestamp,
	"result_url" text,
	"status" "xhs_task_status" DEFAULT 'created' NOT NULL,
	"title" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"visibility" "xhs_visibility" DEFAULT 'public' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xhs_publish_task_log" (
	"created_at" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"level" "xhs_task_log_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"step" text NOT NULL,
	"task_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xhs_account_config" ADD CONSTRAINT "xhs_account_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xhs_publish_task" ADD CONSTRAINT "xhs_publish_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xhs_publish_task_log" ADD CONSTRAINT "xhs_publish_task_log_task_id_xhs_publish_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."xhs_publish_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "xhs_account_config_user_id_unique" ON "xhs_account_config" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "xhs_account_config_status_idx" ON "xhs_account_config" USING btree ("status");--> statement-breakpoint
CREATE INDEX "xhs_publish_task_user_id_idx" ON "xhs_publish_task" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "xhs_publish_task_status_idx" ON "xhs_publish_task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "xhs_publish_task_created_at_idx" ON "xhs_publish_task" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "xhs_publish_task_log_task_id_idx" ON "xhs_publish_task_log" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "xhs_publish_task_log_created_at_idx" ON "xhs_publish_task_log" USING btree ("created_at");