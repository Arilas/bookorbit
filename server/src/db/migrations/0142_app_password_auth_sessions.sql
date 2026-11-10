ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_authentication_method_chk";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_authentication_method_chk";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_app_password_id_app_passwords_id_fk";
--> statement-breakpoint
DROP INDEX "refresh_tokens_app_password_id_idx";--> statement-breakpoint
DROP INDEX "refresh_tokens_session_family_id_idx";--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "app_password_id" integer;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_app_password_id_app_passwords_id_fk" FOREIGN KEY ("app_password_id") REFERENCES "public"."app_passwords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_app_password_id_idx" ON "auth_sessions" USING btree ("app_password_id");--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN "app_password_id";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN "session_family_id";--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_app_password_auth_chk" CHECK (("auth_sessions"."authentication_method" = 'app_password') = ("auth_sessions"."app_password_id" is not null));--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_authentication_method_chk" CHECK ("auth_sessions"."authentication_method" in ('password', 'oidc', 'magic_link', 'setup', 'legacy', 'app_password'));--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_authentication_method_chk" CHECK ("refresh_tokens"."authentication_method" in ('password', 'oidc', 'magic_link', 'setup', 'legacy', 'app_password'));