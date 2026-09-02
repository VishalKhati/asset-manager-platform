// Extend Express Request with properties set by the auth middleware.
declare namespace Express {
  interface Request {
    userId:   string;
    username: string;
  }
}
