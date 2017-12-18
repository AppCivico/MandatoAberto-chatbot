require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');

const config = require('./bottender.config.js').messenger;

const PAGE_1_PAGE_ID = process.env.PAGE_1_PAGE_ID;
const PAGE_1_ACCESS_TOKEN = process.env.PAGE_1_ACCESS_TOKEN;

const PAGE_2_PAGE_ID = process.env.PAGE_2_PAGE_ID;
const PAGE_2_ACCESS_TOKEN = process.env.PAGE_2_ACCESS_TOKEN;

const mapPageToAccessToken = pageId => {
  switch (pageId) {
	case PAGE_1_PAGE_ID:
		console.log(pageId);
		return PAGE_1_ACCESS_TOKEN;
	case PAGE_2_PAGE_ID:
		console.log(pageId);
		return PAGE_1_ACCESS_TOKEN;
	default:
		console.log("----- DEFAULT ----");
		return PAGE_2_ACCESS_TOKEN;
  }
};

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
