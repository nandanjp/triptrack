CREATE TABLE "day_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"place_id" uuid,
	"starts_at" time,
	"status" text DEFAULT 'planned' NOT NULL,
	"replaced_by_entry_id" uuid,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_entry_attendees" (
	"entry_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	CONSTRAINT "day_entry_attendees_entry_id_participant_id_pk" PRIMARY KEY("entry_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"external_ref" text,
	"lat" double precision,
	"lng" double precision,
	"country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_day_locations" (
	"day_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "trip_day_locations_day_id_location_id_pk" PRIMARY KEY("day_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "trip_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"day_number" integer NOT NULL,
	"date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "day_entries" ADD CONSTRAINT "day_entries_day_id_trip_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."trip_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_entries" ADD CONSTRAINT "day_entries_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_entries" ADD CONSTRAINT "day_entries_replaced_by_fk" FOREIGN KEY ("replaced_by_entry_id") REFERENCES "public"."day_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_entry_attendees" ADD CONSTRAINT "day_entry_attendees_entry_id_day_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."day_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_entry_attendees" ADD CONSTRAINT "day_entry_attendees_participant_id_trip_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."trip_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_locations" ADD CONSTRAINT "trip_day_locations_day_id_trip_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."trip_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_locations" ADD CONSTRAINT "trip_day_locations_location_id_trip_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."trip_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_days" ADD CONSTRAINT "trip_days_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_locations" ADD CONSTRAINT "trip_locations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_entries_day_idx" ON "day_entries" USING btree ("day_id");--> statement-breakpoint
CREATE INDEX "day_entries_place_idx" ON "day_entries" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_external_ref_unique" ON "places" USING btree ("external_ref") WHERE external_ref is not null;--> statement-breakpoint
CREATE INDEX "places_country_idx" ON "places" USING btree ("country");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_days_trip_number_unique" ON "trip_days" USING btree ("trip_id","day_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_days_trip_date_unique" ON "trip_days" USING btree ("trip_id","date") WHERE date is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_locations_trip_name_unique" ON "trip_locations" USING btree ("trip_id","name");