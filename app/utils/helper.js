const Sentry = require('@sentry/node');

Sentry.init({
	dsn: process.env.SENTRY_DSN, environment: process.env.ENV, captureUnhandledRejections: false,
});
module.exports.Sentry = Sentry;
