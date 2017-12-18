require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const config = require('./bottender.config.js').messenger;

const mapPageToAccessToken = (async pageId => {
	let pageId;

	pageId = await MandatoAbertoAPI.getPoliticianData(pageId);
	return pageId;
});

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	verifyToken: config.verifyToken,
	sessionStore: new FileSessionStore(),
});

bot.onEvent(async context => {
	await context.sendText('foobar');
});

const server = createServer(bot);

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
