require('dotenv').config();

const { MessengerBot, FileSessionStore, withTyping } = require('bottender');
const { createServer } = require('bottender/restify');
const config = require('./bottender.config.js').messenger;
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const Articles = require('./utils/articles.js');
const request = require('requisition');

const apiUri = process.env.MANDATOABERTO_API_URL;

const phoneRegex = new RegExp(/^\+55\d{2}(\d{1})?\d{8}$/);

let articles;
let politicianData;
let pollAnswer;
let trajectory;
let promptOptions;

let pollData = {};
let recipientData = {};

recipientData[
	'fb_id',
	'name',
	'origin_dialog',
	'email',
	'cellphone',
	'gender'
];

const mapPageToAccessToken = (async (pageId) => {
	politicianData = await MandatoAbertoAPI.getPoliticianData(pageId);
	pollData = await MandatoAbertoAPI.getPollData(pageId);
	trajectory = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'trajectory');

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

bot.use(withTyping({ delay: 1000 }));

bot.onEvent(async (context) => {
	// Abrindo bot através de comentários e posts
	if (context.event.rawEvent.field == 'feed') {
		let item;
		let comment_id;
		let permalink;
		let introduction;
		const post_id = context.event.rawEvent.value.post_id;
		const page_id = post_id.substr(0, post_id.indexOf('_'));

		switch (context.event.rawEvent.value.item) {
		case 'comment':
			item = 'comment';
			comment_id = context.event.rawEvent.value.comment_id;
			permalink = context.event.rawEvent.value.post.permalink_url;

			await MandatoAbertoAPI.postPrivateReply(item, page_id, post_id, comment_id, permalink);
			break;
		case 'post':
			item = 'post';

			await MandatoAbertoAPI.postPrivateReply(item, page_id, post_id, comment_id, permalink);
			break;
		}
	}

	// Tratando caso de o poĺítico não ter dados suficientes
	if (!context.state.dialog) {
		if (!politicianData.greetings && (!politicianData.contact && !pollData.questions)) {
			console.log('Politician does not have enough data');
			return false;
		}
		await context.resetState();
		await context.setState({ dialog: 'greetings' });
	}

	// Tratando botão GET STARTED
	if (context.event.postback && context.event.postback.payload == 'greetings') {
		await context.resetState();
		await context.setState({ dialog: 'greetings' });
	}

	// Tratando dinâmica de issues
	if (context.state.dialog == 'prompt') {
		if (context.event.isQuickReply) {
			const payload = context.event.message.quick_reply.payload;
			await context.setState({ dialog: payload });
		} else if (context.event.isText) {
			// Ao mandar uma mensagem que não é interpretada como fluxo do chatbot
			// Devo já criar uma issue
			const issue_message = context.event.message.text;
			const issue = await MandatoAbertoAPI.postIssue(politicianData.user_id, context.session.user.id, issue_message);

			await context.resetState();

			await context.setState({ dialog: 'issue_created' });
		}
	}

	// Switch de dialogos
	if (context.event.isQuickReply && (context.state.dialog == 'prompt' || context.event.message.quick_reply.payload == 'greetings')) {
		const payload = context.event.message.quick_reply.payload;
		await context.setState({ dialog: payload });
	}

	// Resposta de enquete
	const propagateIdentifier = 'pollAnswerPropagate';
	if (context.event.isQuickReply && context.state.dialog == 'pollAnswer') {
		poll_question_option_id = context.event.message.quick_reply.payload;
		const origin = 'dialog';
		await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id, origin);
	} else if (context.event.isQuickReply && context.event.message.quick_reply.payload && context.event.message.quick_reply.payload.includes(propagateIdentifier)) {
		// Tratando resposta da enquete através de propagação
		const payload = context.event.message.quick_reply.payload;

		poll_question_option_id = payload.substr(payload.indexOf('_') + 1, payload.length);
		const origin = 'propagate';
		await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id, origin);

		context.setState({ dialog: 'pollAnswer' });
	} else if (context.event.isText && context.state.dialog == 'pollAnswer') {
		// Ao mandar uma mensagem que não é interpretada como fluxo do chatbot
		// Devo já criar uma issue
		const issue_message = context.event.message.text;
		const issue = await MandatoAbertoAPI.postIssue(politicianData.user_id, context.session.user.id, issue_message);
		await context.resetState();
		await context.setState({ dialog: 'issue_created' });
		// This is the old way of handling text messages during the poll dialog.
		// It asks for confirmation from user. Whats above creates issue automatically like in 'prompt'.
		// const issue_acknowledgment_message = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'issue_acknowledgment');
		// promptOptions = [
		// 	{
		// 		content_type: 'text',
		// 		title: 'Sim',
		// 		payload: 'issue',
		// 	},
		// 	{
		// 		content_type: 'text',
		// 		title: 'Não',
		// 		payload: 'greetings',
		// 	},
		// ];
		// if (Object.keys(issue_acknowledgment_message).length === 0) {
		// 	await context.sendText('Não entendi sua mensagem, mas quero te ajudar. Você quer enviar uma mensagem para outros membros de nosso equipe?');
		// 	await context.sendText('Quer deixar uma mensagem conosco?', {
		// 		quick_replies: promptOptions,
		// 	});
		// } else {
		// 	await context.sendText(issue_acknowledgment_message.content);
		// 	await context.sendText('Quer deixar uma mensagem conosco?', {
		// 		quick_replies: promptOptions,
		// 	});
		// }
		// await context.setState({ dialog: 'prompt' });
	}

	// Tratando dados adicionais do recipient
	if (context.state.dialog == 'recipientData' && context.state.recipientData) {
		if (context.state.recipientData) {
			switch (context.state.recipientData) {
			case 'email':
				recipientData.fb_id = context.session.user.id;
				recipientData.email = context.event.message.text;
				await MandatoAbertoAPI.postRecipient(politicianData.user_id, recipientData);
				recipientData = {};

				await context.sendQuickReplies({ text: 'Legal, agora quer me informar seu telefone, para lhe manter informado sobre outras enquetes?' }, [
					{
						content_type: 'text',
						title: 'Sim',
						payload: 'recipientData',
					},
					{
						content_type: 'text',
						title: 'Não',
						payload: 'recipientData',
					},
				]);

				await context.setState({
					dialog: 'recipientData',
					recipientData: 'cellphonePrompt',
					dataPrompt: '',
				});
				break;
			case 'cellphone':
				recipientData.fb_id = context.session.user.id;
				recipientData.cellphone = context.event.message.text;
				recipientData.cellphone = recipientData.cellphone.replace(/[- .)(]/g, '');
				recipientData.cellphone = `+55${recipientData.cellphone}`;

				if (phoneRegex.test(recipientData.cellphone)) {
					await MandatoAbertoAPI.postRecipient(politicianData.user_id, recipientData);
				} else {
					await context.setState({
						dataPrompt: '',
						recipientData: 'cellphonePrompt',
					});

					await context.sendText('Desculpa, mas seu telefone não parece estar correto.');

					await context.sendQuickReplies({ text: 'Vamos tentar de novo?' }, [
						{
							content_type: 'text',
							title: 'Sim',
							payload: 'recipientData',
						},
						{
							content_type: 'text',
							title: 'Não',
							payload: 'recipientData',
						},
					]);
				}

				recipientData = {};
				break;
			case 'cellphonePrompt':
				await context.setState({
					dialog: 'recipientData',
					dataPrompt: 'cellphone',
				});
				break;
			}
		}
	}

	switch (context.state.dialog) {
	case 'greetings':
		// Criando um cidadão
		recipientData.fb_id = context.session.user.id;
		recipientData.name = `${context.session.user.first_name} ${context.session.user.last_name}`;
		recipientData.gender = context.session.user.gender == 'male' ? 'M' : 'F';
		recipientData.origin_dialog = 'greetings';
		recipientData.picture = context.session.user.profile_pic;
		const recipient = await MandatoAbertoAPI.postRecipient(politicianData.user_id, recipientData);
		recipientData = {};

		introduction = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'introduction');
		let issue_message = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'issue_acknowledgment');

		if (Object.keys(issue_message).length === 0) {
			issue_message = 'A qualquer momento você pode digitar uma mensagem e eu enviarei para o gabinete.';
		} else {
			issue_message = issue_message.content;
		}

		let about_me_text;

		if (politicianData.office.name == 'Outros' || politicianData.office.name == 'Candidato' || politicianData.office.name == 'Candidata') {
			about_me_text = `Sobre ${articles.defined} líder`;
		} else {
			about_me_text = `Sobre ${articles.defined} ${politicianData.office.name}`;
		}

		if (introduction.content && pollData.questions) {
			promptOptions = [
				// {
				// 	content_type: 'text',
				// 	title: 'Fale conosco',
				// 	payload: 'issue'
				// },
				{
					content_type: 'text',
					title: about_me_text,
					payload: 'aboutMe',
				},
				{
					content_type: 'text',
					title: 'Dê sua opinião',
					payload: 'poll',
				},
			];
		} else if (introduction.content && !pollData.questions) {
			promptOptions = [
				// {
				// 	content_type: 'text',
				// 	title: 'Fale conosco',
				// 	payload: 'issue'
				// },
				{
					content_type: 'text',
					title: about_me_text,
					payload: 'aboutMe',
				},
			];
		} else if (!introduction.content && pollData.questions) {
			promptOptions = [
				// {
				// 	content_type: 'text',
				// 	title: 'Fale conosco',
				// 	payload: 'issue'
				// },
				{
					content_type: 'text',
					title: 'Dê sua opinião',
					payload: 'poll',
				},
			];
		} else if (!introduction.content && !pollData.questions && politicianData.contact) {
			promptOptions = [
				// {
				// 	content_type: 'text',
				// 	title: 'Fale conosco',
				// 	payload: 'issue'
				// },
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contacts',
				},
			];
		}

		let greeting = politicianData.greeting.replace('${user.office.name}', politicianData.office.name);
		greeting = greeting.replace('${user.name}', politicianData.name);
		await context.sendText(greeting);
		await context.sendText(issue_message, {
			quick_replies: promptOptions,
		});

		await context.setState({ dialog: 'prompt' });

		break;
	case 'mainMenu': // after issue is created we come back to this dialog
	console.log('\n\naaaaa');

	introduction = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'introduction');

	let about_me_text2;

	if (politicianData.office.name == 'Outros' || politicianData.office.name == 'Candidato' || politicianData.office.name == 'Candidata') {
		about_me_text2 = `Sobre ${articles.defined} líder`;
	} else {
		about_me_text2 = `Sobre ${articles.defined} ${politicianData.office.name}`;
	}

	if (introduction.content && pollData.questions) {
		promptOptions = [
			// {
			// 	content_type: 'text',
			// 	title: 'Fale conosco',
			// 	payload: 'issue'
			// },
			{
				content_type: 'text',
				title: about_me_text2,
				payload: 'aboutMe',
			},
			{
				content_type: 'text',
				title: 'Dê sua opinião',
				payload: 'poll',
			},
		];
	} else if (introduction.content && !pollData.questions) {
		promptOptions = [
			// {
			// 	content_type: 'text',
			// 	title: 'Fale conosco',
			// 	payload: 'issue'
			// },
			{
				content_type: 'text',
				title: about_me_text2,
				payload: 'aboutMe',
			},
		];
	} else if (!introduction.content && pollData.questions) {
		promptOptions = [
			// {
			// 	content_type: 'text',
			// 	title: 'Fale conosco',
			// 	payload: 'issue'
			// },
			{
				content_type: 'text',
				title: 'Dê sua opinião',
				payload: 'poll',
			},
		];
	} else if (!introduction.content && !pollData.questions && politicianData.contact) {
		promptOptions = [
			// {
			// 	content_type: 'text',
			// 	title: 'Fale conosco',
			// 	payload: 'issue'
			// },
			{
				content_type: 'text',
				title: 'Contatos',
				payload: 'contacts',
			},
		];
	}

	console.log('\n\nbbbbb');
	await context.sendText('Como posso te ajudar?', {
		quick_replies: promptOptions,
	});
	await context.setState({ dialog: 'prompt' });
	break;
	case 'aboutMe':
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
					title: 'Contatos',
					payload: 'contacts',
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
					title: 'Contatos',
					payload: 'contacts',
				},
			];
		}
		await context.sendQuickReplies({ text: `O que mais deseja saber sobre ${articles.defined} ${politicianData.office.name}?` }, promptOptions);
		await context.setState({ dialog: 'prompt' });
		break;
	case 'contacts':
		// Tratando o formato do telefone
		if (politicianData.contact.cellphone) {
			politicianData.contact.cellphone = politicianData.contact.cellphone.replace(/(?:\+55)+/g, '');
			politicianData.contact.cellphone = politicianData.contact.cellphone.replace(/^(\d{2})/g, '($1)');
		}

		await context.sendText(`Você pode entrar em contato com ${articles.defined} ${politicianData.office.name} ${politicianData.name} pelos seguintes canais:`);

		if (politicianData.contact.email) {
			await context.sendText(` - Através do email: ${politicianData.contact.email}`);
		}
		if (politicianData.contact.cellphone) {
			await context.sendText(` - Através do WhatsApp: ${politicianData.contact.cellphone}`);
		}
		if (politicianData.contact.twitter) {
			await context.sendText(` - Através do Twitter: ${politicianData.contact.twitter}`);
		}
		if (politicianData.contact.url) {
			await context.sendText(` - Através do site: ${politicianData.contact.url}`);
		}

		if (trajectory.content && pollData.questions) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Trajetória',
					payload: 'trajectory',
				},
				{
					content_type: 'text',
					title: 'Dê sua opinião',
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
					title: 'Dê sua opinião',
					payload: 'poll',
				},
			];
		}

		await context.sendQuickReplies({ text: 'Quer saber mais?' }, promptOptions);

		await context.setState({ dialog: 'prompt' });

		break;

	case 'poll':
		// Verifico se o cidadão já  a enquete atualmente ativa
		const recipientAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, pollData.id);

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

		// Agora a enquete poderá ser respondida via propagação ou via dialogo
		if (recipientAnswer.recipient_answered >= 1) {
			await context.sendText('Você já respondeu a enquete atualmente ativa.');

			await context.sendQuickReplies({ text: 'Se quiser, eu posso te ajudar com outra coisa.' }, promptOptions);

			await context.setState({ dialog: 'prompt' });
		} else {
			await context.sendText('Quero conhecer você melhor. Deixe sua resposta e participe deste debate.');
			await context.sendQuickReplies({ text: `Pergunta: ${pollData.questions[0].content}` }, [
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
			await context.setState({ dialog: 'pollAnswer' });
		}
		break;
	case 'pollAnswer':

		await context.sendQuickReplies({ text: 'Muito obrigado por sua reposta. Você gostaria de deixar seu email e telefone  para nossa equipe?' }, [
			{
				content_type: 'text',
				title: 'Vamos lá!',
				payload: 'recipientData',
			},
			{
				content_type: 'text',
				title: 'Agora não',
				payload: 'recipientData',
			},
		]);

		await context.setState({
			dialog: 'prompt',
			dataPrompt: 'email',
		});

		break;
	case 'recipientData':
		if (context.event.message.text == 'Agora não' || context.event.message.text == 'Não') {
			await context.sendQuickReplies({ text: 'Está bem! Posso te ajudar com mais alguma informação?' }, promptOptions);

			await context.setState({ dialog: 'prompt' });
		} else if (context.state.dataPrompt) {
			switch (context.state.dataPrompt) {
			case 'email':
				await context.sendText('Qual é o seu e-mail?');
				await context.setState({
					dialog: 'recipientData',
					recipientData: 'email',
				});
				break;
			case 'cellphone':
				await context.sendText('Qual é o seu telefone?');
				await context.setState({
					dialog: 'recipientData',
					recipientData: 'cellphone',
					dataPrompt: 'end',
				});
				break;
			case 'cellphoneFail':

				break;
			case 'end':
				await context.sendText('Pronto, já guardei seus dados.');
				await context.sendQuickReplies({ text: 'Quer saber mais?' }, promptOptions);
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
					title: 'Dê sua opinião',
					payload: 'poll',
				},
				{
					content_type: 'text',
					title: 'Contatos',
					payload: 'contacts',
				},
			];
		} else if (pollData.questions && !politicianData.contact) {
			promptOptions = [
				{
					content_type: 'text',
					title: 'Dê sua opinião',
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

		await context.sendQuickReplies({ text: 'Quer saber mais?' }, promptOptions);

		await context.setState({ dialog: 'prompt' });

		break;

	case 'issue':
		await context.sendText('Escreva sua mensagem para nossa equipe:');

		await context.setState({
			dialog: 'prompt',
			prompt: 'issue',
		});

		break;

	case 'issue_created':
		const issue_created_message = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'issue_created');
		await context.sendText(issue_created_message.content, {
			quick_replies: [
				{
					content_type: 'text',
					title: 'Voltar ao início',
					payload: 'mainMenu',
				},
			],
		});
		await context.setState({ dialog: 'prompt' });
		break;
	}
});

const server = createServer(bot, { verifyToken: config.verifyToken });

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
