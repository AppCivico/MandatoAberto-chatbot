/* global  bot:true builder:true */
/* eslint no-param-reassign: ["error", { "props": true, "ignorePropertyModificationsFor":
["session"] }] */

require('dotenv').config();
require('./connectorSetup.js');

const Articles = require('./utils/articles.js');

const MandaAbertoAPI = require('./mandatoaberto_api.js');

const DialogFlowReconizer = require('./dialogflow_recognizer.js');

// Opções de botões
const PromptOptions = {
	AboutPolitician: 'Quero saber',
	Poll: 'Responder enquete',
	Contacts: 'Contatos',
};

let articles;
let politicianData;
let pollData;

const intents = new builder.IntentDialog({
	recognizers: [
		DialogFlowReconizer,
	],
	intentThreshold: 0.2,
	recognizeOrder: builder.RecognizeOrder.series,
});

intents.matches('greetings', '/greetings');

bot.dialog('/', intents);

// Ação disparada pelo botão 'get_started' do Facebook
bot.beginDialogAction('getstarted', '/greetings');

bot.dialog('/greetings', [

	(session) => {
		function callback(politician) {
			politicianData = politician;

			// Deve-se indentificar o sexo do representante público
			// e selecionar os artigos (definido e possesivo) adequados
			if (politicianData.gender === 'F') {
				articles = Articles.feminine;
			} else {
				articles = Articles.masculine;
			}

			session.sendTyping();
			session.send(`O que mais deseja saber sobre ${articles.defined} ${politicianData.office.name}?`);
			builder.Prompts.choice(
				session,
				'Em que assunto eu posso te ajudar?',
				[PromptOptions.AboutPolitician, PromptOptions.Poll],
				{ listStyle: builder.ListStyle.button, retryPrompt: 'fail' } // eslint-disable-line comma-dangle
			);
		}

		MandaAbertoAPI.getPoliticianData(callback);
	},

	(session, args) => {
		if (args.response) {
			switch (args.response.entity) {
			case PromptOptions.AboutPolitician:
				session.sendTyping();
				session.send(politicianData.greeting.text);
				builder.Prompts.choice(
					session,
					`O que mais deseja saber sobre ${articles.defined} ${politicianData.office.name}?`,
					[PromptOptions.Contacts],
					{ listStyle: builder.ListStyle.button, retryPrompt: 'fail' } // eslint-disable-line comma-dangle
				);
				break;
			case PromptOptions.Poll:
				session.replaceDialog('/poll');
				break;
			default:
				session.send('Opção inválida. Por favor, tente novamente.');
				session.replaceDialog('/greetings');
				break;
			}
		}
	},

	(session, args) => {
		if (args.response) {
			switch (args.response.entity) {
			case PromptOptions.Contacts:
				session.replaceDialog('/contact');
				break;
				// Falta Trajetória
			default:
				session.send('Opção inválida. Por favor, tente novamente.');
				session.replaceDialog('/greetings');
				break;
			}
		}
	},

	(session, args) => {
		if (args.response) {
			switch (args.response.entity) {
			case PromptOptions.AboutPolitician:
				session.sendTyping();
				session.send(politicianData.greeting.text);
				builder.Prompts.choice(
					session,
					`O que mais deseja saber sobre o ${politicianData.office.name}?`,
					[PromptOptions.Contacts],
					{ listStyle: builder.ListStyle.button, retryPrompt: 'fail' } // eslint-disable-line comma-dangle
				);
				break;
			case PromptOptions.Poll:
				session.replaceDialog('/poll');
				break;
			default:
				session.send('Opção inválida. Por favor, tente novamente.');
				session.replaceDialog('/greetings');
				break;
			}
		}
	},
]);

bot.dialog('/contact', [
	(session) => {
		session.sendTyping();
		session.send(`Você pode entrar em contato com ${articles.defined} ${politicianData.office.name}
			através do e-mail: ${politicianData.contact.email}, pelo telefone: ${politicianData.contact.cellphone},
			e até pelo seu Twitter: ${politicianData.contact.twitter}`);
		builder.Prompts.choice(
			session,
			'Posso te ajudar com outra coisa?',
			[PromptOptions.Contacts, PromptOptions.Poll],
			{ listStyle: builder.ListStyle.button, retryPrompt: 'fail' } // eslint-disable-line comma-dangle
		);
	},

	(session, args) => {
		if (args.response) {
			switch (args.response.entity) {
			case PromptOptions.Contacts:
				session.replaceDialog('/contact');
				break;
			case PromptOptions.Poll:
				session.replaceDialog('/poll');
				break;
			default:
				session.send('Opção inválida. Por favor, tente novamente.');
				session.replaceDialog('/contact');
				break;
			}
		}
	},
]);

bot.dialog('/poll', [
	(session) => {
		function callback(poll) {
			pollData = poll;
			const options = [
				pollData.questions[0].options[0].content,
				pollData.questions[0].options[1].content,
			];
			session.sendTyping();
			session.send(`Que legal.
		É muito importante entender o que a população pensa para criarmos
		iniciativas que de fato impactem positivamente na vida de todos.`);
			builder.Prompts.choice(
				session,
				pollData.questions[0].content,
				options,
				{ listStyle: builder.ListStyle.button, retryPrompt: 'fail' } // eslint-disable-line comma-dangle
			);
		}
		MandaAbertoAPI.getPoll(callback);
	},

	(session, args) => {
		if (args.response) {
			switch (args.response.entity) {
			case pollData.polls[0].questions[0].options[0].content:
				session.sendTyping();
				session.send('Muito obrigado, é muito importante a participação da população nesse processo de elaboração de projetos.');
				builder.Prompts.text(session, `Você gostaria de assinar a nossa petição para dar mais força ao projeto?
		Para isso é só me falar seu email, vamos lá?`);
				break;
			case pollData.polls[0].questions[0].options[1].content:
				session.sendTyping();
				session.send('Muito obrigado, é muito importante a participação da população nesse processo de elaboração de projetos.');
				session.replaceDialog('/greetings');
				break;
			default:
				session.send('Opção inválida. Por favor, tente novamente.');
				session.replaceDialog('/poll');
				break;
			}
		}
	},

	(session, args) => {
		if (args.response) {
			session.dialogData.email = args.response;
			session.sendTyping();
			builder.Prompts.text(session, 'Legal, agora pode me informar seu telefone, para lhe manter informado sobre outras enquetes?');
		}
	},

	(session, args) => {
		if (args.response) {
			session.dialogData.cellphone = args.response;
			console.log(session.dialogData);
			session.sendTyping();
			session.send(`Pronto, já guardei seus dados.
		Vou lhe enviar o resultado atual da enquete, e assim que terminar a pesquisa eu lhe envio o resultado final.`);
			builder.Prompts.choice(
				session,
				'Posso te ajudar com outra coisa?',
				[PromptOptions.AboutPolitician],
				{ listStyle: builder.ListStyle.button, retryPrompt: 'fail' } // eslint-disable-line comma-dangle
			);
		}
	},

	(session, args) => {
		if (args.response) {
			switch (args.response.entity) {
			case PromptOptions.AboutPolitician:
				session.replaceDialog('/greetings');
				break;
			default:
				session.send('Opção inválida. Por favor, tente novamente.');
				session.replaceDialog('/poll');
				break;
			}
		}
	},
]);
