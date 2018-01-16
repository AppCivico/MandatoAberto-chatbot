require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');
const config = require('./bottender.config.js').messenger;
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const Articles = require('./utils/articles.js');
// const request = require('requisition');

const phoneRegex = new RegExp(/^\+55\d{2}(\d{1})?\d{8}$/);

let articles;
let politicianData;
let pollData;
// let pollAnswer;
let citizenAnswer;
let trajectory;
let introduction;
let promptOptions;

let citizenData = {};
// citizenData[
// 	'fb_id',
// 	'name',
// 	'origin_dialog',
// 	'email',
// 	'cellphone',
// 	'gender'
// ];

const mapPageToAccessToken = (async (pageId) => {
	politicianData = await MandatoAbertoAPI.getPoliticianData(pageId);
	pollData = await MandatoAbertoAPI.getPollData(pageId);
	trajectory = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'trajectory');
	introduction = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'introduction');

	// Deve-se indentificar o sexo do representante público
	// e selecionar os artigos (definido e possesivo) adequados
	if (politicianData.gender === 'F') {
		articles = Articles.feminine;
	} else {
		articles = Articles.masculine;
	}

	return process.env.ACCESS_TOKEN;
	// return politicianData.fb_access_token;
});

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.setInitialState({});

bot.onEvent(async (context) => {
	// console.log(context.event.rawEvent);
	if (!context.state.dialog) {
		if (!politicianData.greetings && (!politicianData.contact && !pollData.questions)) {
			console.log('Politician does not have enough data');
		}
		await context.setState({ dialog: 'greetings' });
	}

	if (context.event.postback && context.event.postback.payload === 'greetings') {
		await context.setState({ dialog: 'greetings' });
	}

	if (context.state.dialog === 'prompt') {
		if (context.event.isQuickReply) {
			const { payload } = context.event.message.quick_reply;
			await context.setState({ dialog: payload });
		} else if (context.event.isText) {
			await context.sendText('Meus algoritmos estão em aprendizagem, pois ainda sou um robo novo. ' +
			'Infelizmente não consegui entender o que você disse. Mas vou guardar sua mensagem e assim que tiver uma resposta eu te mando.');

			if (introduction.content && pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Sobre o líder',
						payload: 'aboutMe',
					},
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					},
				];
			} else if (introduction.content && !pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Sobre o líder',
						payload: 'aboutMe',
					},
				];
			} else if (!introduction.content && pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					},
				];
			}

			await context.sendText('Posso te ajudar com outra coisa?', {
				quick_replies: promptOptions,
			});

			await context.setState({ dialog: 'prompt' });
		}
	}

	if (context.event.isQuickReply && (context.state.dialog === 'prompt' || context.event.message.quick_reply.payload === 'greetings')) {
		const { payload } = context.event.message.quick_reply;
		await context.setState({ dialog: payload });
	}

	if (context.event.isQuickReply && context.state.dialog === 'pollAnswer') {
		const { payload } = context.event.message.quick_reply;
		await MandatoAbertoAPI.postPollAnswer(context.session.user.id, payload);
		await context.setState({ dialog: 'pollAnswer' });
	}

	if (context.state.dialog === 'citizenData' && context.state.citizenData) {
		if (context.state.citizenData) {
			switch (context.state.citizenData) { // eslint-disable-line default-case
			case 'email':
				citizenData.fb_id = context.session.user.id;
				citizenData.email = context.event.message.text;
				await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
				citizenData = {};

				await context.sendText('Legal, agora quer me informar seu telefone, ' +
					' para lhe manter informado sobre outras enquetes?', {
					quick_replies: [
						{
							content_type: 'text',
							title: 'Sim',
							payload: 'citizenData',
						},
						{
							content_type: 'text',
							title: 'Não',
							payload: 'citizenData',
						},
					],
				});

				await context.setState({
					dialog: 'citizenData',
					citizenData: 'cellphonePrompt',
					dataPrompt: '',
				});
				break;
			case 'cellphone':
				citizenData.fb_id = context.session.user.id;
				console.log(citizenData.fb_id);
				citizenData.cellphone = context.event.message.text;
				console.log(citizenData.cellphone);
				citizenData.cellphone = citizenData.cellphone.replace(/[- .)(]/g, '');
				console.log(citizenData.cellphone);
				citizenData.cellphone = `+55${citizenData.cellphone}`;
				console.log(citizenData.cellphone);

				if (phoneRegex.test(citizenData.cellphone)) {
					await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
				} else {
					await context.setState({
						dataPrompt: '',
						citizenData: 'cellphonePrompt',
					});

					await context.sendText('Desculpa, mas seu telefone não parece estar correto.');

					await context.sendText('Vamos tentar de novo?', {
						quick_replies: [
							{
								content_type: 'text',
								title: 'Sim',
								payload: 'citizenData',
							},
							{
								content_type: 'text',
								title: 'Não',
								payload: 'citizenData',
							},
						],
					});
				}

				citizenData = {};
				break;
			case 'cellphonePrompt':
				await context.setState({
					dialog: 'citizenData',
					dataPrompt: 'cellphone',
				});
				break;
			}
		}
	}
	switch (context.state.dialog) { // eslint-disable-line default-case
	case 'greetings': {
		// Criando um cidadão
		citizenData.fb_id = context.session.user.id;
		citizenData.name = `${context.session.user.first_name} ${context.session.user.last_name}`;
		citizenData.gender = context.session.user.gender === 'male' ? 'M' : 'F';
		citizenData.origin_dialog = 'greetings';

		const citizen = await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
		console.log(`Citizen: ${Object.entries(citizen)}`);
		console.log(`CitizenData: ${Object.entries(citizenData)}`);
		citizenData = {};

		introduction = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'introduction');

		if (introduction.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Sobre o líder',
					payload: 'aboutMe',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		} else if (introduction.content && !pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Sobre o líder',
					payload: 'aboutMe',
				},
			];
		} else if (!introduction.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		}

		let greeting = politicianData.greeting.replace('${user.office.name}', politicianData.office.name); // eslint-disable-line no-template-curly-in-string
		greeting = greeting.replace('${user.name}', politicianData.name); // eslint-disable-line no-template-curly-in-string
		await context.sendText(greeting);

		await context.sendText('Como posso te ajudar?', {
			quick_replies: promptOptions,
		});

		await context.setState({ dialog: 'prompt' });

		break;
	}
	case 'aboutMe': {
		const introductionText = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'introduction');
		await context.sendText(introductionText.content);

		if (trajectory.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		} else if (trajectory.content && !pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
			];
		} else if (!trajectory.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		}

		await context.sendText('O que mais deseja saber sobre ' +
			` ${articles.defined} ${politicianData.office.name}?`, {
			quick_replies: promptOptions,
		});

		await context.setState({ dialog: 'prompt' });

		break;
	}
	case 'contacts': {
		// Tratando o formato do telefone
		if (politicianData.contact.cellphone) {
			politicianData.contact.cellphone = politicianData.contact.cellphone.replace(/(?:\+55)+/g, '');
			politicianData.contact.cellphone = politicianData.contact.cellphone.replace(/^(\d{2})/g, '($1)');
		}

		const contactText = `Você pode entrar em contato com ${articles.defined} ${politicianData.office.name} ${politicianData.name} pelos seguintes canais:\n${
			politicianData.contact.email ? ` - através do email: ${politicianData.contact.email}\n` : ''
		}${politicianData.contact.cellphone ? ` - através do WhatsApp: ${politicianData.contact.cellphone}\n` : ''
		}${politicianData.contact.twitter ? ` - através do Twitter: ${politicianData.contact.twitter}` : ''}`;
		await context.sendText(contactText);

		if (trajectory.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		} else if (trajectory.content && !pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
			];
		} else if (!trajectory.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		}

		await context.sendText('Posso te ajudar com outra informação?', {
			quick_replies: promptOptions,
		});

		await context.setState({ dialog: 'prompt' });

		break;
	}
	case 'poll': {
		// Verifico se o cidadão já respondeu a enquete atualmente ativa
		citizenAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, pollData.id);

		if (trajectory.content && politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contacts',
				},
			];
		} else if (trajectory.content && !politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
			];
		} else if (!trajectory.content && politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contacts',
				},
			];
		}

		if (citizenAnswer.citizen_answered === 0) {
			// TODO mudar isso pra 1 (teste)
			await context.sendText('Você já respondeu a enquete atualmente ativa');
			await context.sendText('Se quiser, eu posso te ajudar com outra coisa.', {
				quick_replies: promptOptions,
			});

			await context.setState({ dialog: 'prompt' });
		} else {
			await context.sendText('Que legal, é muito importante conhecer você e sua comunidade para criarmos iniciativas ' +
			'que impactem positivamente na vida de todos.');

			await context.sendText(`${pollData.questions[0].content}`, {
				quick_replies: [
					{
						content_type: 'text',
						title: pollData.questions[0].options[1].content,
						payload: `${pollData.questions[0].options[1].id}`,
					},
					{
						content_type: 'text',
						title: pollData.questions[0].options[0].content,
						payload: `${pollData.questions[0].options[0].id}`,
					},
				],
			});
			await context.setState({ dialog: 'pollAnswer' });
		}
		break;
	}
	case 'pollAnswer':
		await context.sendText('Muito obrigado, é muito importante a participação da população nesse processo de elaboração de projetos.');
		await context.sendText('Você gostaria de assinar a nossa petição para dar mais força ao projeto? ' +
			'Para isso, é só me falar seu email, vamos lá?', {
			quick_replies: [
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
			],
		});
		await context.setState({
			dialog: 'prompt',
			dataPrompt: 'email',
		});
		break;
	case 'citizenData':
		if (context.event.message.text === 'Agora não' || context.event.message.text === 'Não') {
			await context.sendText('Beleza!');
			await context.sendText('Se quiser, eu posso te ajudar com outra coisa.', {
				quick_replies: promptOptions,
			});
			await context.setState({ dialog: 'prompt' });
		} else if (context.state.dataPrompt) {
			switch (context.state.dataPrompt) { // eslint-disable-line default-case
			case 'email':
				await context.sendText('Qual é o seu e-mail?');
				await context.setState({
					dialog: 'citizenData',
					citizenData: 'email',
				});

				break;
			case 'cellphone':
				await context.sendText('Qual é o seu telefone?');
				await context.setState({
					dialog: 'citizenData',
					citizenData: 'cellphone',
					dataPrompt: 'end',
				});
				break;
			case 'cellphoneFail':
				// TODO ??
				break;
			case 'end':
				await context.sendText('Pronto, já guardei seus dados. Vou lhe enviar o resultado atual da enquete, ' +
				'e assim que terminar a pesquisa eu lhe envio o resultado final');
				console.log(`aaa: ${Object.entries(promptOptions)}`);
				await context.sendText('Posso te ajudar com outra informação?', {
					quick_replies: promptOptions,
				});
				await context.setState({ dialog: 'prompt' });
				break;
			}
		}
		break;
	case 'trajectory':
		await context.sendText(trajectory.content);
		if (pollData.questions && politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contacts',
				},
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		} else if (pollData.questions && !politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Responder enquete',
					payload: 'poll',
				},
			];
		} else if (!pollData.questions && politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contacts',
				},
			];
		}
		await context.sendText('Posso te ajudar com outra informação?', {
			quick_replies: promptOptions,
		});
		await context.setState({ dialog: 'prompt' });
		break;
	case 'noData':
		await context.sendText('Olá! Por enquanto não consigo fazer muito, mas em breve poderemos conversar sobre várias coisas!');
		break;
	}
	return undefined;
});

const server = createServer(bot, { verifyToken: config.verifyToken });

server.listen(process.env.API_PORT, () => {
	console.log(`Api_Url:  ${process.env.MANDATOABERTO_API_URL}`);
	console.log(`Server is running on ${process.env.API_PORT} port...`);
});
