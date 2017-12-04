/* global  bot:true */

require('./connectorSetup.js');
require('dotenv').config();

const request = require('request');

bot.beginDialogAction('getstarted', '/getstarted');
bot.beginDialogAction('reset', '/reset');

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
