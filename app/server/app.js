/* global  bot:true */

require('./connectorSetup.js');
require('dotenv').config();
const request = require('request');

request('http://dapimandatoaberto.eokoe.com/api/state', (error, response, body) => {
	console.log('error', error);
	console.log('statusCode:', response && response.statusCode);
	console.log('body:', body);
	console.log(JSON.stringify(response, null, 3));
	console.log(`Esses são os headers\n${JSON.stringify(response.headers, null, 3)}`);
	console.log(`Essa é a data\n${JSON.stringify(response.headers.date, null, 3)}`);
});


bot.beginDialogAction('hello', '/hello');

bot.dialog('/', [
	(session) => {
		session.replaceDialog('/hello');
	},
]);

bot.dialog('/hello', [
	(session) => {
		session.send(`Hello World :) ${process.env.TESTE}`);
	},
]);
