CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"actor_username" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"target_username" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"telegram_token" text,
	"telegram_chat_id" text,
	"telegram_enabled" boolean DEFAULT false NOT NULL,
	"email_to" text,
	"smtp_host" text,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_user" text,
	"smtp_pass" text,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"events" text[] DEFAULT '{"signal","trade_opened","trade_closed"}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"symbol" text NOT NULL,
	"condition" text NOT NULL,
	"target_price" numeric(18, 4) NOT NULL,
	"label" text,
	"active" boolean DEFAULT true NOT NULL,
	"triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"symbol" text NOT NULL,
	"t" bigint NOT NULL,
	"o" double precision NOT NULL,
	"h" double precision NOT NULL,
	"l" double precision NOT NULL,
	"c" double precision NOT NULL,
	"spread" double precision NOT NULL,
	"volume" double precision DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_at" timestamp with time zone,
	CONSTRAINT "candles_symbol_t_pk" PRIMARY KEY("symbol","t")
);
--> statement-breakpoint
CREATE TABLE "feeders" (
	"id" text PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_bar_t" bigint,
	"server_utc_offset_min" integer,
	"terminal_connected" boolean,
	"version" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "news_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"ext_id" text NOT NULL,
	"currency" text NOT NULL,
	"title" text NOT NULL,
	"impact" text NOT NULL,
	"t" bigint NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_evaluations" (
	"symbol" text NOT NULL,
	"t" bigint NOT NULL,
	"reason" text NOT NULL,
	"close" double precision,
	"diag" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_state" (
	"symbol" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"paused_by" text,
	"cooldown_until" bigint DEFAULT 0 NOT NULL,
	"last_bar_t" bigint DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"feed_alert_open" boolean DEFAULT false NOT NULL,
	"news_fetched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"signal_id" integer,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"signal_id" integer NOT NULL,
	"type" text NOT NULL,
	"t" bigint NOT NULL,
	"price" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_no" text NOT NULL,
	"symbol" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"config_id" integer NOT NULL,
	"mode" text NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"direction" text NOT NULL,
	"t" bigint NOT NULL,
	"entry_ref" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"tp1" double precision NOT NULL,
	"tp2" double precision NOT NULL,
	"risk" double precision NOT NULL,
	"atr" double precision NOT NULL,
	"spread" double precision NOT NULL,
	"valid_until" bigint NOT NULL,
	"state" text NOT NULL,
	"sl_current" double precision NOT NULL,
	"fill" double precision,
	"fill_t" bigint,
	"deadline" bigint,
	"remaining" double precision DEFAULT 1 NOT NULL,
	"realized" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text,
	"closed_t" bigint,
	"r_gross" double precision,
	"r_cost" double precision,
	"r_net" double precision,
	"telegram_messages" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_public_no_unique" UNIQUE("public_no")
);
--> statement-breakpoint
CREATE TABLE "strategy_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"params" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_events" ADD CONSTRAINT "signal_events_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_config_id_strategy_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."strategy_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_alerts_user_id_idx" ON "price_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "price_alerts_active_idx" ON "price_alerts" USING btree ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "news_events_source_ext_uq" ON "news_events" USING btree ("source","ext_id");--> statement-breakpoint
CREATE INDEX "news_events_t_idx" ON "news_events" USING btree ("t");--> statement-breakpoint
CREATE UNIQUE INDEX "engine_evaluations_pk" ON "engine_evaluations" USING btree ("symbol","t");--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "signal_events_signal_idx" ON "signal_events" USING btree ("signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_bar_uq" ON "signals" USING btree ("strategy_id","symbol","mode","t");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_one_open_uq" ON "signals" USING btree ("symbol","mode") WHERE "signals"."state" in ('pending', 'active', 'be');--> statement-breakpoint
CREATE INDEX "signals_symbol_t_idx" ON "signals" USING btree ("symbol","t");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_configs_one_active_uq" ON "strategy_configs" USING btree ("symbol") WHERE "strategy_configs"."is_active";