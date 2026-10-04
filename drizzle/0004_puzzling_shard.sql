CREATE TABLE "expense_shares" (
	"expense_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	CONSTRAINT "expense_shares_expense_id_participant_id_pk" PRIMARY KEY("expense_id","participant_id"),
	CONSTRAINT "expense_shares_amount_nonzero" CHECK (amount_minor <> 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"day_id" uuid,
	"booking_id" uuid,
	"entry_id" uuid,
	"description" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"paid_by_participant_id" uuid NOT NULL,
	"split_mode" text DEFAULT 'equal' NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_single_parent" CHECK ((case when day_id is null then 0 else 1 end
         + case when booking_id is null then 0 else 1 end
         + case when entry_id is null then 0 else 1 end) <= 1),
	CONSTRAINT "expenses_amount_nonzero" CHECK (amount_minor <> 0),
	CONSTRAINT "expenses_currency_format" CHECK (currency ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_participant_id_trip_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."trip_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_day_id_trip_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."trip_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_entry_id_day_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."day_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_participant_id_trip_participants_id_fk" FOREIGN KEY ("paid_by_participant_id") REFERENCES "public"."trip_participants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_shares_participant_idx" ON "expense_shares" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "expenses_trip_idx" ON "expenses" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "expenses_day_idx" ON "expenses" USING btree ("day_id");--> statement-breakpoint
CREATE INDEX "expenses_booking_idx" ON "expenses" USING btree ("booking_id");