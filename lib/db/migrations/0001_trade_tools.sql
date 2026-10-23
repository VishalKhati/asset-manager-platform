CREATE TABLE "account_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"status" text NOT NULL,
	"direction" text NOT NULL,
	"lots" double precision NOT NULL,
	"entry" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"tp1" double precision NOT NULL,
	"tp2" double precision NOT NULL,
	"risk_money" double precision NOT NULL,
	"currency" text NOT NULL,
	"checks" jsonb NOT NULL,
	"odds" jsonb,
	"sent_to_broker" boolean DEFAULT false NOT NULL,
	"approved_by" text NOT NULL,
	"via" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_t" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trade_tickets" ADD CONSTRAINT "trade_tickets_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_tickets_one_per_signal" ON "trade_tickets" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "trade_tickets_approved_t_idx" ON "trade_tickets" USING btree ("approved_t");