// Express 4 doesn't await route handlers, so a rejected promise inside an
// async handler would otherwise be an unhandled rejection and the request
// would just hang with no response. Wrapping routes with this forwards
// errors to Express's default error handler (a 500 response) instead.
export function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
