CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"confirmation_code" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location_id" uuid,
	"status" text DEFAULT 'booked' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_day_bookings" (
	"day_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	CONSTRAINT "trip_day_bookings_day_id_booking_id_pk" PRIMARY KEY("day_id","booking_id")
);
--> statement-breakpoint
ALTER TABLE "trip_days" ADD COLUMN "lodging_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_trip_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."trip_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_bookings" ADD CONSTRAINT "trip_day_bookings_day_id_trip_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."trip_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_day_bookings" ADD CONSTRAINT "trip_day_bookings_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_trip_idx" ON "bookings" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "bookings_trip_kind_idx" ON "bookings" USING btree ("trip_id","kind");--> statement-breakpoint
ALTER TABLE "trip_days" ADD CONSTRAINT "trip_days_lodging_booking_id_bookings_id_fk" FOREIGN KEY ("lodging_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;