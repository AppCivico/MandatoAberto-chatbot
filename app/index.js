require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const apiUri = process.env.MANDATOABERTO_API_URL;
const config = require('./bottender.config.js').messenger;
const request = require('requisition');

const mapPageToAccessToken = (async pageId => {
	const res = await request(`${apiUri}/api/chatbot?fb_page_id=${pageId}`).query(pageId);
	const body = await res.json();
	return body.access_token;
});

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.onEvent(async context => {
	await context.sendText('foobar');
	await const politicianData = MandatoAbertoAPI.getPoliticianData(pageId);
	console.log(politicianData);
});

const server = createServer(bot, { verifyToken: config.verifyToken } );

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
