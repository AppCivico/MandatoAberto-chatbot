const accents = require('remove-accents');
const Sentry = require('@sentry/node');

Sentry.init({
	dsn: process.env.SENTRY_DSN, environment: process.env.ENV, captureUnhandledRejections: false,
});
module.exports.Sentry = Sentry;

async function formatString(text) {
	let result = text.toLowerCase();
	result = await result.replace(/([\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2580-\u27BF]|\uD83E[\uDD10-\uDDFF])/g, '');
	result = await accents.remove(result);
	if (result.length >= 250) {
		result = result.slice(0, 250);
	}
	return result.trim();
}
module.exports.formatString = formatString;
