require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');

const config = require('./bottender.config.js').messenger;

const bot = new MessengerBot({
	accessToken: config.accessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.onEvent(async context => {
    console.log(context);
	await context.sendText('foobar');
    await context.sendText('fizzbuzz');
});

const server = createServer(bot);

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
