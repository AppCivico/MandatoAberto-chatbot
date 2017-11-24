/* global  bot:true */

require('./connectorSetup.js');
require('dotenv').config();

bot.beginDialogAction('hello', '/hello');

bot.dialog('/', [
	(session) => {
		session.replaceDialog('/hello');
	},
]);

bot.dialog('/hello', [
	(session) => {
		session.send('Hello World :)');
	},
]);
