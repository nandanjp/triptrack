CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"from_participant_id" uuid NOT NULL,
	"to_participant_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"settled_on" date NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_amount_positive" CHECK (amount_minor > 0),
	CONSTRAINT "settlements_currency_format" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "settlements_distinct_parties" CHECK (from_participant_id <> to_participant_id)
);
--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_from_participant_id_trip_participants_id_fk" FOREIGN KEY ("from_participant_id") REFERENCES "public"."trip_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_to_participant_id_trip_participants_id_fk" FOREIGN KEY ("to_participant_id") REFERENCES "public"."trip_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlements_trip_idx" ON "settlements" USING btree ("trip_id");