require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');
const MandaAbertoAPI = require('./mandatoaberto_api.js');
const config = require('./bottender.config.js').messenger;

const mapPageToAccessToken = pageId => {
	console.log(MandaAbertoAPI);
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
