ALTER TABLE "reading_attempts" ALTER COLUMN "external_provider" SET DATA TYPE varchar(100);--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD COLUMN "app_password_id" integer;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "app_password_id" integer;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "app_password_id" integer;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD CONSTRAINT "audiobook_progress_app_password_id_app_passwords_id_fk" FOREIGN KEY ("app_password_id") REFERENCES "public"."app_passwords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_app_password_id_app_passwords_id_fk" FOREIGN KEY ("app_password_id") REFERENCES "public"."app_passwords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_app_password_id_app_passwords_id_fk" FOREIGN KEY ("app_password_id") REFERENCES "public"."app_passwords"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abp_app_password_user_idx" ON "audiobook_progress" USING btree ("app_password_id","user_id");--> statement-breakpoint
CREATE INDEX "reading_progress_app_password_user_idx" ON "reading_progress" USING btree ("app_password_id","user_id");--> statement-breakpoint
CREATE INDEX "rs_app_password_user_started_at_idx" ON "reading_sessions" USING btree ("app_password_id","user_id","started_at");