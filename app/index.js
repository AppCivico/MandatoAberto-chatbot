require('dotenv').config();

const { MessengerBot, FileSessionStore } = require('bottender');
const { createServer } = require('bottender/restify');
const config = require('./bottender.config.js').messenger;
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const Articles = require('./utils/articles.js');
const request = require('requisition');

const apiUri = process.env.MANDATOABERTO_API_URL;

const phoneRegex = new RegExp(/^\+55\d{2}(\d{1})?\d{8}$/);

let articles;
let politicianData;
let pollData;
let pollAnswer;
let trajectory;
let promptOptions;

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

bot.onEvent(async context => {

	if (!context.state.dialog) {
		if ( !politicianData.greetings && ( !politicianData.contact && !pollData.questions ) ) {
			console.log("Politician does not have enough data");
			return false;
		} else {
			await context.setState( { dialog: 'greetings' } )
		}
	}

	if (context.event.postback && context.event.postback.payload == 'greetings') {
		await context.setState( { dialog: 'greetings' } )
	}

	if (context.state.dialog == 'prompt') {
		if (context.event.isQuickReply) {
			const payload = context.event.message.quick_reply.payload;
			await context.setState( { dialog: payload } );
		} else if (context.event.isText) {
			if (context.state.prompt && context.state.prompt == 'issue') {
				const issue = await MandatoAbertoAPI.postIssue(politicianData.user_id, context.session.user.id, context.event.message.text);
				await context.sendText("Muito obrigado pela sua mensagem, iremos responde-la em breve!");

				await context.setState( { dialog: 'greetings' } );
			} else {
				const misunderstand_message = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'misunderstand');
				await context.sendText(misunderstand_message ? misunderstand_message : 'Não entendi sua mensagem, mas quero te ajudar. Você quer enviar uma mensagem para outros membros de nosso equipe?');

				promptOptions = [
					{
						content_type: 'text',
						title: 'Sim',
						payload: 'issue'
					},
					{
						content_type: 'text',
						title: 'Não',
						payload: 'greetings'
					},
				]

				await context.sendQuickReplies({ text: 'Posso te ajudar com outra coisa?' }, promptOptions);

				await context.setState( { dialog: 'prompt' } );
			}
		}
	}

	if (context.event.isQuickReply && (context.state.dialog == 'prompt' || context.event.message.quick_reply.payload == 'greetings') ) {
		const payload = context.event.message.quick_reply.payload;
		await context.setState( { dialog: payload } );
	}

	if (context.event.isQuickReply && context.state.dialog == 'pollAnswer') {
		poll_question_option_id = context.event.message.quick_reply.payload;
		await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id);
	}

	if (context.state.dialog == 'citizenData' && context.state.citizenData) {

		if (context.state.citizenData) {
			switch (context.state.citizenData) {
				case 'email':
					citizenData.fb_id = context.session.user.id;
					citizenData.email = context.event.message.text;
					await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
					citizenData = {};

					await context.sendQuickReplies({ text: 'Legal, agora quer me informar seu telefone, para lhe manter informado sobre outras enquetes?'  }, [
						{
							content_type: 'text',
							title: 'Sim',
							payload: 'citizenData',
						},
						{
							content_type: 'text',
							title: 'Não',
							payload: 'citizenData',
						}
					]);

					await context.setState(
						{
							dialog: 'citizenData',
							citizenData: 'cellphonePrompt',
							dataPrompt: ''
						}
					);
					break;
				case 'cellphone':
					citizenData.fb_id = context.session.user.id;
					citizenData.cellphone = context.event.message.text;
					citizenData.cellphone = citizenData.cellphone.replace(/[- .)(]/g, '');
					citizenData.cellphone = '+55' + citizenData.cellphone;

					if (phoneRegex.test(citizenData.cellphone)) {
						await MandatoAbertoAPI.postCitizen(politicianData.user_id, citizenData);
					} else {
						await context.setState(
							{
								dataPrompt: '',
								citizenData: 'cellphonePrompt'
							}
						);

						await context.sendText("Desculpa, mas seu telefone não parece estar correto.");

						await context.sendQuickReplies({ text: 'Vamos tentar de novo?'  }, [
							{
								content_type: 'text',
								title: 'Sim',
								payload: 'citizenData',
							},
							{
								content_type: 'text',
								title: 'Não',
								payload: 'citizenData',
							}
						]);
					}

					citizenData = {};
					break;
				case 'cellphonePrompt':
					await context.setState(
						{
							dialog: 'citizenData',
							dataPrompt: 'cellphone'
						}
					);
					break;
			}
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
			citizenData = {};

			const introduction = await MandatoAbertoAPI.getAnswer(politicianData.user_id, 'introduction');

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
					}
				];
			} else if (introduction.content && !pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Sobre o líder',
						payload: 'aboutMe',
					}
				];
			} else if (!introduction.content && pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					}
				];
			}

			let greeting = politicianData.greeting.replace('${user.office.name}', politicianData.office.name);
			greeting = greeting.replace('${user.name}', politicianData.name);
			await context.sendText(greeting);
			await context.sendQuickReplies({ text: 'Como posso te ajudar?' }, promptOptions);

			await context.setState( { dialog: 'prompt' } );

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
						title: 'Responder enquete',
						payload: 'poll',
					}
				];
			} else if (trajectory.content && !pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Trajetória',
						payload: 'trajectory',
					}
				];
			} else if (!trajectory.content && pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					}
				];
			}

			await context.sendQuickReplies({ text: `O que mais deseja saber sobre ${articles.defined} ${politicianData.office.name}?` }, promptOptions);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'contacts':
			// Tratando o formato do telefone
			if (politicianData.contact.cellphone) {
				politicianData.contact.cellphone = politicianData.contact.cellphone.replace(/(?:\+55)+/g, "");
				politicianData.contact.cellphone = politicianData.contact.cellphone.replace(/^(\d{2})/g, "($1)");
			}

			const contactText = `Você pode entrar em contato com ${articles.defined} ${politicianData.office.name} ${politicianData.name} pelos seguintes canais:\n`
							  + ( politicianData.contact.email ? ` - através do email: ${politicianData.contact.email}\n` : '' )
							  + ( politicianData.contact.cellphone ? ` - através do WhatsApp: ${politicianData.contact.cellphone}\n` : '' )
							  + ( politicianData.contact.twitter ? ` - através do Twitter: ${politicianData.contact.twitter}` : '' );
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
					}
				];
			} else if (trajectory.content && !pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Trajetória',
						payload: 'trajectory',
					}
				];
			} else if (!trajectory.content && pollData.questions) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					}
				];
			}

			await context.sendQuickReplies({ text: `Posso te ajudar com outra informação?` }, promptOptions);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'poll':
			// Verifico se o cidadão já respondeu a enquete atualmente ativa
			const citizenAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, pollData.id);

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
					}
				];
			} else if (trajectory.content && !politicianData.contact) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Trajetória',
						payload: 'trajectory',
					}
				];
			} else if (!trajectory.content && politicianData.contact) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Contatos',
						payload: 'contacts',
					}
				];
			}

			if (citizenAnswer.citizen_answered === 1) {
				await context.sendText('Você já respondeu a enquete atualmente ativa');

				await context.sendQuickReplies({ text: 'Se quiser eu posso te ajudar com outra coisa' }, promptOptions);

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
					}
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
				}
			]);

			await context.setState(
				{
					dialog: 'prompt',
					dataPrompt: 'email'
				}
			);

			break;

		case 'citizenData':
			if ( context.event.message.text == 'Agora não' || context.event.message.text == 'Não' ) {
				await context.sendText('Beleza!');

				await context.sendQuickReplies({ text: 'Se quiser eu posso te ajudar com outra coisa' }, promptOptions);

				await context.setState( { dialog: 'prompt' } );
			} else {

				if (context.state.dataPrompt) {
					switch (context.state.dataPrompt) {
						case 'email':
							await context.sendText('Qual é o seu e-mail?');

							await context.setState(
								{
									dialog: 'citizenData',
									citizenData: 'email'
								}
							);

							break;
						case 'cellphone':
							await context.sendText('Qual é o seu telefone?');

							await context.setState(
								{
									dialog: 'citizenData',
									citizenData: 'cellphone',
									dataPrompt: 'end'
								}
							);
							break;
						case 'cellphoneFail':
							

							break;
						case 'end':
								await context.sendText('Pronto, já guardei seus dados. Vou lhe enviar o resultado atual da enquete, e assim que terminar a pesquisa eu lhe envio o resultado final');

								await context.sendQuickReplies({ text: `Posso te ajudar com outra informação?` }, promptOptions);

								await context.setState( { dialog: 'prompt' } );
							break;
					}
				}
			}

			break;

		case 'trajectory':
			await context.sendText(trajectory.content);

			if (pollData.questions && politicianData.contact) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					},
					{
						content_type: 'text',
						title: 'Contatos',
						payload: 'contacts',
					}
				];
			} else if (pollData.questions && !politicianData.contact) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Responder enquete',
						payload: 'poll',
					}
				];
			} else if (!pollData.questions && politicianData.contact) {
				promptOptions = [
					{
						content_type: 'text',
						title: 'Contatos',
						payload: 'contacts',
					}
				];
			}

			await context.sendQuickReplies({ text: `Posso te ajudar com outra informação?` }, promptOptions);

			await context.setState( { dialog: 'prompt' } );

			break;

		case 'issue':
			await context.sendText('Digite a mensagem que você deseja deixar:');

			await context.setState( 
				{
					dialog: 'prompt',
					prompt: 'issue'
				}
			);

			break;
	}
});

const server = createServer(bot, { verifyToken: config.verifyToken } );

server.listen(process.env.API_PORT, () => {
	console.log(`server is running on ${process.env.API_PORT} port...`);
});
