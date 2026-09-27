// Runs before any test module is imported, so config.ts and @workspace/db see these values.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://unused@localhost/unused";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.FEEDER_HMAC_SECRET ??= "feeder-test-secret";
process.env.SIGNAL_MODE ??= "forward";
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.LOGIN_RATE_LIMIT_PER_15MIN = "100000";
