require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');
const config = require('./bottender.config.js').messenger;
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const Articles = require('./utils/articles.js');
const request = require('requisition');

const apiUri = process.env.MANDATOABERTO_API_URL;

let articles;
let politicianData;

const mapPageToAccessToken = (async pageId => {
	politicianData = await MandatoAbertoAPI.getPoliticianData(pageId);

	// Deve-se indentificar o sexo do representante público
    // e selecionar os artigos (definido e possesivo) adequados
    if (politicianData.gender === 'F') {
        articles = Articles.feminine;
    } else {
        articles = Articles.masculine;
    }
	return politicianData.fb_access_token;
});

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.onEvent(async context => {
    console.log(context._session);
    const introText = `Olá ${context._session.user.first_name}!, sou o assistente digital ${articles.possessive} ${politicianData.office.name} ${politicianData.name}!. Seja benvindo a nossa Rede! Queremos um Brasil a melhor e precisamos de sua ajuda.`;
    await context.sendQuickReplies({ text: introText }, [
        {
          content_type: 'text',
          title: 'Quero saber',
          payload: 'about_me',
        },
        {
          content_type: 'text',
          title: 'Responder enquete',
          payload: 'poll',
        },
    ]);
	console.log(politicianData);
});

const server = createServer(bot, { verifyToken: config.verifyToken } );

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
