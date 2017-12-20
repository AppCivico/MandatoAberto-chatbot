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
let pollData;
let pollAnswer;

let citizenData = {};
citizenData[
	'fb_id',
	'name',
	'origin_dialog',
	'email',
	'cellphone',
	'gender'
];

const mapPageToAccessToken = (async pageId => {
	politicianData = await MandatoAbertoAPI.getPoliticianData(pageId);
	pollData = await MandatoAbertoAPI.getPollData(pageId);

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

bot.setInitialState({});

bot.onEvent(async context => {

	if (!context.state.dialog) {
		await context.setState( { dialog: 'greetings' } )
	}

	if (context.state.dialog == 'prompt') {
		if (context.event.isQuickReply) {
			const payload = context.event.message.quick_reply.payload;
			await context.setState( { dialog: payload } );
		} else if (context.event.isText) {
			await context.sendText('Meus algoritmos estão em aprendizagem, pois ainda sou um robo novo. Infelizmente não consegui entender o que você disse. Mas vou guardar sua mensagem e assim que tiver uma resposta eu te mando.');
			await context.sendQuickReplies({ text: 'Posso te ajudar com outra coisa?' }, [
				{
					content_type: 'text',
					title: 'Quero saber',
					payload: 'aboutMe',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			]);

			await context.setState( { dialog: 'prompt' } );
		}
	}

	if (context.event.isQuickReply && context.state.dialog == 'prompt') {
		const payload = context.event.message.quick_reply.payload;
		await context.setState( { dialog: payload } );
	}

	if (context.event.isQuickReply && context.state.dialog == 'pollAnswer') {
		option_id = context.event.message.quick_reply.payload;
		await MandatoAbertoAPI.postPollAnswer(context.session.user.id, option_id);
	}

	if (context.event.isText && context.state.dialog == 'citizenData' && context.state.citizenData) {
		if (context.state.citizenData == 'email') {
			citizenData.email = context.event.message.text;
		} else if (context.state.citizenData == 'cellphone') {
			citizenData.cellphone = context.event.message.text;
			await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
		}
	}

	switch (context.state.dialog) {
		case 'greetings':
			// Criando um cidadão
			citizenData.fb_id = context.session.user.id;
			citizenData.name = context.session.user.first_name + ' ' + context.session.user.last_name;
			citizenData.gender = context.session.user.gender == 'male' ? 'M' : 'F';
			citizenData.origin_dialog = 'greetings';

			const citizen = await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
			console.log(citizen);

			const introText = `Olá ${context.session.user.first_name}!, sou o assistente digital ${articles.possessive} ${politicianData.office.name} ${politicianData.name}!. Seja benvindo a nossa Rede! Queremos um Brasil a melhor e precisamos de sua ajuda.`;
			await context.sendQuickReplies({ text: introText }, [
				{
					content_type: 'text',
					title: 'Quero saber',
					payload: 'aboutMe',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			]);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'aboutMe':
			await context.sendText(politicianData.greeting);

			await context.sendQuickReplies({ text: `O que mais deseja saber sobre ${articles.defined} ${politicianData.office.name}?` }, [
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contact',
				},
				{
					content_type: 'text',
					title: 'Trajetória',
					// trajetória e bandeiras, dialogo
					payload: 'trajectory',
				},
			]);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'contact':
			const contactText = `Você pode entrar em contato com ${articles.defined} ${politicianData.office.name} ${politicianData.name} através do email: ${politicianData.contact.email}, pelo telefone ${politicianData.contact.cellphone}`
			await context.sendText(contactText);

			await context.sendQuickReplies({ text: `Posso te ajudar com outra informação?` }, [
				{
					content_type: 'text',
					title: 'Trajetória',
					// trajetória e bandeiras, dialogo
					payload: 'trajectory',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			]);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'poll':
			// Verifico se o cidadão já respondeu a enquete atualmente ativa
			const citizenAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, pollData.id);

			if (citizenAnswer.citizen_answered === 1) {
				await context.sendText('Você já respondeu a enquete atualmente ativa');

				await context.sendQuickReplies({ text: 'Se quiser eu posso te ajudar com outra coisa' }, [
					{
						content_type: 'text',
						title: 'Quero saber',
						payload: 'aboutMe',
					},
				]);

				await context.setState( { dialog: 'prompt' } );
			} else {
				await context.sendText('Que legal, é muito importante conhecer você e sua comunidade para criarmos iniciativas que impactem positivamente na vida de todos.');

				await context.sendQuickReplies({ text: pollData.questions[0].content }, [
					{
						content_type: 'text',
						title: pollData.questions[0].options[0].content,
						payload: `${pollData.questions[0].options[0].id}`,
					},
					{
						content_type: 'text',
						title: pollData.questions[0].options[1].content,
						payload: `${pollData.questions[0].options[1].id}`,
					},
				]);

				await context.setState(	{ dialog: 'pollAnswer' } );
			}

			break;

		case 'pollAnswer':
			await context.sendText('Muito obrigado, é muito importante a participação da população nesse processo de elaboração de projetos.');

			await context.sendQuickReplies({ text: 'Você gostaria de assinar a nossa petição para dar mais força ao projeto? Para isso é só me falar seu email, vamos la?'  }, [
				{
					content_type: 'text',
					title: 'Vamos lá!',
					payload: 'citizenData',
				},
				{
					content_type: 'text',
					title: 'Agora não',
					payload: 'citizenData',
				},
			]);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'citizenData':
			if (context.event.isText && context.event.message.text == 'Agora não') {
				await context.sendText('Beleza!');

				await context.sendQuickReplies({ text: 'Se quiser eu posso te ajudar com outra coisa' }, [
					{
						content_type: 'text',
						title: 'Quero saber',
						payload: 'aboutMe',
					},
				]);

				await context.setState( { dialog: 'prompt' } );
			} else {
				if (!citizenData.email) {
					await context.sendText('Qual é o seu e-mail?');

					await context.setState(
						{
							dialog: 'citizenData',
							citizenData: 'email'
						}
					);
				} else if (!citizenData.cellphone) {
					await context.sendText('Legal, agora pode me informar seu telefone, para lhe manter informado sobre outras enquetes?');

					await context.setState(
						{
							dialog: 'citizenData',
							citizenData: 'cellphone'
						}
					);
				} else {
					await context.sendText('Pronto, já guardei seus dados. Vou lhe enviar o resultado atual da enquete, e assim que terminar a pesquisa eu lhe envio o resultado final');

					await context.sendQuickReplies({ text: `Posso te ajudar com outra informação?` }, [
						{
							content_type: 'text',
							title: 'Quero saber',
							payload: 'aboutMe',
						}
					]);

					await context.setState( { dialog: 'prompt' } );
				}
			}

			break;

		case 'trajectory':
			const dialogName = 'Trajetória';
			const dialog = await MandatoAbertoAPI.getDialog(politicianData.user_id, dialogName);

			await context.sendText(dialog.questions[0].answer.content);

			await context.sendQuickReplies({ text: `Posso te ajudar com outra informação?` }, [
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contact',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			]);

			await context.setState( { dialog: 'prompt' } );

			break;

		default:
			// Criando um cidadão
			citizenData.fb_id = context.session.user.id;
			citizenData.name = context.session.user.first_name + ' ' + context.session.user.last_name;
			citizenData.gender = context.session.user.gender == 'male' ? 'M' : 'F';
			citizenData.origin_dialog = 'greetings';

			citizen = await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);

			introText = `Olá ${context.session.user.first_name}!, sou o assistente digital ${articles.possessive} ${politicianData.office.name} ${politicianData.name}!. Seja benvindo a nossa Rede! Queremos um Brasil a melhor e precisamos de sua ajuda.`;
			await context.sendQuickReplies({ text: introText }, [
				{
					content_type: 'text',
					title: 'Quero saber',
					payload: 'aboutMe',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			]);

			await context.setState( { dialog: 'prompt' } );

			break;
	}
});

const server = createServer(bot, { verifyToken: config.verifyToken } );

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
