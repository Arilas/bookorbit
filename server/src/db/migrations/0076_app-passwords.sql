CREATE TABLE "app_passwords" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" varchar(100) NOT NULL,
	"selector" varchar(32) NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"secret_hint" varchar(32) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" varchar(45),
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_passwords_selector_unique" UNIQUE("selector"),
	CONSTRAINT "app_passwords_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "app_passwords_expires_after_created_chk" CHECK ("app_passwords"."expires_at" > "app_passwords"."created_at")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "app_password_id" integer;--> statement-breakpoint
ALTER TABLE "app_passwords" ADD CONSTRAINT "app_passwords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_passwords_user_id_idx" ON "app_passwords" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_passwords_expires_at_idx" ON "app_passwords" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_app_password_id_app_passwords_id_fk" FOREIGN KEY ("app_password_id") REFERENCES "public"."app_passwords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_app_password_id_idx" ON "refresh_tokens" USING btree ("app_password_id");