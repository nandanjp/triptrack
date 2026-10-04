ALTER TABLE "trips" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "trips_share_token_unique" ON "trips" USING btree ("share_token") WHERE share_token is not null;