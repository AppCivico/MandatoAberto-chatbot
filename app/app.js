/* global  bot:true */
require('dotenv').config();
require('./connectorSetup.js');

const doido = require('./mandatoaberto_api.js');
doido.greetings();

let DialogFlowReconizer = require('./dialogflow_recognizer.js');

const request = require('request');

let intents = new builder.IntentDialog({
    recognizers: [
        DialogFlowReconizer
    ],
    intentThreshold: 0.2,
    recognizeOrder: builder.RecognizeOrder.series
});

intents.matches('greetings', '/greetings');

bot.dialog('/', intents);

// On Get_Started Facebook button
bot.beginDialogAction('getstarted', '/greetings');

bot.dialog('/greetings', [
    (session, args, next) => {
        console.log(doido);
        session.send("Oi");
    }
]);