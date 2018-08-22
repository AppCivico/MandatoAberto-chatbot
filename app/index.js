require('dotenv').config();

const {
	MessengerBot, FileSessionStore, withTyping, MessengerHandler,
} = require('bottender');
const { createServer } = require('bottender/restify');
const dialogFlow = require('apiai-promise');
const config = require('./bottender.config.js').messenger;
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const VotoLegalAPI = require('./votolegal_api.js');
const Articles = require('./utils/articles.js');
const opt = require('./utils/options');
const attach = require('./attach');

const apiai = dialogFlow(process.env.DIALOGFLOW_TOKEN);

const phoneRegex = new RegExp(/^\+55\d{2}(\d{1})?\d{8}$/);

function getMoney(str) {
	return parseInt(str.replace(/[\D]+/g, ''), 0);
}
function formatReal(int) {
	let tmp = `${int}`;
	tmp = tmp.replace(/([0-9]{2})$/g, ',$1');
	if (tmp.length > 6) {
		tmp = tmp.replace(/([0-9]{3}),([0-9]{2}$)/g, '.$1,$2');
	}
	return tmp;
}

const IssueTimerlimit = 10000 * 2; // 20 seconds -> listening to user doubts
const MenuTimerlimit = 10000 * 6; // 60 seconds -> waiting to show the initial menu

const issueTimers = {};
const postIssueTimers = {};
const menuTimers = {};
// const pollTimers = {};
// timers -> object that stores timers. Each user_id stores it's respective timer.
// issueTimers -> stores timers that creates issues
// postIssueTimers -> stores timers that confirm to the user that we have sent his "issue"
// menuTimers -> stores timers that show to the user the initial menu

const userMessages = {};
// userMessages -> stores user messages from issues. We can't use a regular state for this because the timer can't save state "after session has been written"
// sendIntro = true -> context.state.sendIntro -> verifies if we should send the "coudln't understand" or the "talkToUs" text for issue creation.
// listening = true -> context.state.listening -> verifies if we should aggregate text on userMessages
let areWeListening = true;
// areWeListening -> user.state.areWeListening(doesn't work) -> diferenciates messages that come from the standard flow and messages from comment/post

function removeEmptyKeys(obj) { Object.keys(obj).forEach((key) => { if (obj[key].length === 0) { delete obj[key]; } }); }

const mapPageToAccessToken = async (pageId) => {
	const politicianData2 = await MandatoAbertoAPI.getPoliticianData(pageId);
	return politicianData2.fb_access_token;
};

const bot = new MessengerBot({
	mapPageToAccessToken,
	appSecret: config.appSecret,
	sessionStore: new FileSessionStore(),
});

bot.setInitialState({});

bot.use(withTyping({ delay: 1000 }));

// Deve-se indentificar o sexo do representante público e selecionar os artigos (definido e possesivo) adequados
function getArticles(gender) {
	if (gender === 'F') {
		return Articles.feminine;
	}
	return Articles.masculine;
}

// function getAboutMe(politicianData) {
// 	const articles = getArticles(politicianData.gender);

// 	if (politicianData.office.name === 'Outros' || politicianData.office.name === 'Candidato' || politicianData.office.name === 'Candidata') {
// 		return `Sobre ${articles.defined} líder`;
// 	} if (politicianData.office.name === 'candidato' || politicianData.office.name === 'candidata') {
// 		return `${articles.defined.toUpperCase()} ${politicianData.office.name}`;
// 	}
// 	return `Sobre ${articles.defined} ${politicianData.office.name}`;
// }

async function showQuestions(context) {
	await context.typingOn();
	await attach.sendQuestions(context, context.state.knowledge.knowledge_base);
	await context.sendText('Ok! Por favor, escolha sua pergunta acima ⤴️\nSe não achou é só clicar abaixo ⤵️', {
		quick_replies: [
			{
				content_type: 'text',
				title: 'Não achei',
				payload: 'NotOneOfThese',
			},
		],
	});
	await context.typingOff();
	await context.setState({ dialog: 'prompt' });
}

function getIssueMessage(issueMessage) {
	if (Object.keys(issueMessage).length === 0) {
		return 'A qualquer momento você pode digitar uma mensagem que enviarei para nosso time.';
	}
	return issueMessage.content;
}

async function checkPollAnswered(context) {
	const recipientAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, context.state.pollData.id);
	if (recipientAnswer.recipient_answered >= 1) {
		return true;
	}
	return false;
}

async function checkMenu(context, dialogs) { // eslint-disable-line no-inner-declarations
	if (!context.state.introduction) { // just in case something goes way off
		await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
		await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
	}
	if (!context.state.introduction.content) { dialogs = dialogs.filter(obj => obj.payload !== 'aboutMe'); }
	if (!context.state.trajectory) { dialogs = dialogs.filter(obj => obj.payload !== 'trajectory'); }
	if (!context.state.pollData) { dialogs = dialogs.filter(obj => obj.payload !== 'poll'); }
	if (!context.state.politicianData.contact) { dialogs = dialogs.filter(obj => obj.payload !== 'contacts'); }
	if (dialogs.find(x => x.payload === 'poll')) {
		if (await checkPollAnswered(context) === true) { // already answered so we remove option
			dialogs = dialogs.filter(obj => obj.payload !== 'poll');
			dialogs.push(opt.talkToUs);
		}
	}
	if (!context.state.politicianData.votolegal_integration) { dialogs = dialogs.filter(obj => obj.payload !== 'votoLegal'); }
	// if (dialogs[0].payload === 'aboutMe') { dialogs[0].title = getAboutMe(context.state.politicianData); }
	return dialogs;
}

const handler = new MessengerHandler()
	.onEvent(async (context) => { // eslint-disable-line
		if (!context.event.isDelivery && !context.event.isEcho && !context.event.isRead && context.event.rawEvent.field !== 'feed') {
			await context.typingOn();

			// we reload politicianData on every useful event
			// we update context data at every interaction that's not a comment or a post
			await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
			await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });

			console.log('logging every event:');
			console.log(context.event);


			if (context.state.dialog !== 'recipientData') { // handling input that's not from "asking data"
				if (context.event.isPostback) { // this could be in a better place
					if (context.event.postback.payload.slice(0, 6) === 'answer') {
						await context.setState({ question: context.state.knowledge.knowledge_base.find(x => x.id === parseInt(context.event.postback.payload.replace('answer', ''), 10)) });
						await context.setState({ dialog: 'showAnswer' });
					} else if (context.event.postback.payload === 'talkToUs') { // user wants to enter in contact
						await context.setState({ sendIntro: false });
						await context.setState({ listening: false });
						await context.setState({ dialog: 'createIssue' });
					} else {
						await context.setState({ dialog: context.event.postback.payload });
					}
				} else if (context.event.isQuickReply) {
					const { payload } = context.event.message.quick_reply;
					if (payload.slice(0, 6) === 'option') {
						await context.setState({ payload: payload.replace('option', '') });
						await context.setState({
							knowledge: await MandatoAbertoAPI.getknowledgeBase(context.state.politicianData.user_id,
								{ [context.state.payload]: context.state.apiaiResp.result.parameters[context.state.payload] }),
						});
						await showQuestions(context);
					} else {
						await context.setState({ dialog: payload });
					}
				} else if (context.event.isAudio) {
					await context.sendText('Aúdio? Ok!');
					console.log(context.event);
					console.log('----');
					console.log(context.event.audio);
				} else if (context.event.isText) {
					await context.setState({ whatWasTyped: context.event.message.text }); // will be used in case the bot doesn't find the question
					await context.setState({ apiaiResp: await apiai.textRequest(context.state.whatWasTyped, { sessionId: context.session.user.id }) });
					removeEmptyKeys(context.state.apiaiResp.result.parameters);
					console.log(context.state.apiaiResp);

					if (context.state.apiaiResp.result.metadata.intentName === 'Fallback') {
						// Fallback --> counldn't find any matching intents
						// check if message came from standard flow or from post/comment
						if (areWeListening === true) {
							await context.setState({ dialog: 'createIssue' });
						} else {
							await context.setState({ dialog: 'intermediate' });
						}
					} else if (context.state.apiaiResp.result.metadata.intentName === 'Pergunta') {
						if (Object.keys(context.state.apiaiResp.result.parameters).length === 1) { // found intent and 1 entity
							await context.setState({
								knowledge: await MandatoAbertoAPI.getknowledgeBase(context.state.politicianData.user_id, context.state.apiaiResp.result.parameters),
							});
							if (context.state.knowledge.knowledge_base.length === 0) { // we have no questions related to this entity
								// TODO falta fazer algo quando não tem pergunta cadastrada!
								if (areWeListening === true) {
									await context.setState({ dialog: 'createIssue' });
								} else {
									await context.setState({ dialog: 'intermediate' });
								}
							} else {
								// instead of showing the questions already, we confirm with the user the one theme
								console.log(context.state.knowledge);
								// await context.sendButtonTemplate('Você está perguntando sobre '
								// + `${context.state.knowledge.knowledge_base.join(', ').replace(/,(?=[^,]*$)/, ' e')}?`, opt.themeConfirmation);
								await showQuestions(context);
							}
						} else { // found intent but 2+ entities
							await context.setState({ dialog: 'chooseTheme' });
						}
						// } else if (context.state.apiaiResp.result.metadata.intentName === 'talkToUs') {
						// // to be added
					}
				}
			}
		}

		if (context.session) {
			// if the user interacts while this timer is running we don't need to show the menu anymore
			if (menuTimers[context.session.user.id]) { clearTimeout(menuTimers[context.session.user.id]); }

			// if the user interacts while this timer is running we don't need to run confirm that the issue was sent anymore
			if (postIssueTimers[context.session.user.id]) { clearTimeout(menuTimers[context.session.user.id]); }
		}
		if (context.event.rawEvent.postback) {
			if (context.event.rawEvent.postback.referral) { // if this exists we are on external site
				await context.setState({ facebookPlataform: 'CUSTOMER_CHAT_PLUGIN' });
			} else { // if it doesn't exists we are on an facebook/messenger
				await context.setState({ facebookPlataform: 'MESSENGER' });
			}

			await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
				fb_id: context.session.user.id,
				name: `${context.session.user.first_name} ${context.session.user.last_name}`,
				gender: context.session.user.gender === 'male' ? 'M' : 'F',
				origin_dialog: 'greetings',
				picture: context.session.user.profile_pic,
				session: JSON.stringify(context.state),
			});
		}

		// Abrindo bot através de comentários e posts
		// ** no context here **
		if (context.event.rawEvent.field === 'feed') {
			let item;
			let comment_id;
			let permalink;
			// let introduction;
			const post_id = context.event.rawEvent.value.post_id;
			const page_id = post_id.substr(0, post_id.indexOf('_'));
			const user_id = context.event.rawEvent.value.from.id;
			areWeListening = false;
			switch (context.event.rawEvent.value.item) {
			case 'comment':
				item = 'comment';
				comment_id = context.event.rawEvent.value.comment_id;
				permalink = context.event.rawEvent.value.post.permalink_url;
				await MandatoAbertoAPI.postPrivateReply(item, page_id, post_id, comment_id, permalink, user_id);
				break;
			case 'post':
				item = 'post';
				await MandatoAbertoAPI.postPrivateReply(item, page_id, post_id, comment_id, permalink, user_id);
				break;
			}
		} else {
			// Tratando caso de o político não ter dados suficientes
			if (!context.state.dialog) {
				await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
				await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
				if (!context.state.politicianData.greetings && (!context.state.politicianData.contact && !context.state.pollData.questions)) {
					console.log('Politician does not have enough data');
					return false;
				}
				await context.resetState();
				await context.setState({ dialog: 'greetings' });
			}

			// Tratando botão GET STARTED
			if (context.event.postback && context.event.postback.payload === 'greetings') {
				await context.resetState();
				await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
				await context.setState({ dialog: 'greetings' });
			}

			// Switch de dialogos
			if (context.event.isPostback && (context.state.dialog === 'prompt' || context.event.postback.payload === 'greetings')) {
				const { payload } = context.event.postback;
				await context.setState({ dialog: payload });
			}
			// quick_replies que vem de propagação que não são resposta de enquete
			// because of the issue response
			if (context.event.isQuickReply && (context.state.dialog !== 'pollAnswer') && !(context.event.message.quick_reply.payload.includes('pollAnswerPropagate'))) {
				await context.setState({ dialog: context.event.message.quick_reply.payload });
			}
			// Resposta de enquete
			if (context.event.isQuickReply && context.state.dialog === 'pollAnswer') {
				const poll_question_option_id = context.event.message.quick_reply.payload;
				await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id, 'dialog');
			} else if (context.event.isQuickReply && context.event.message.quick_reply.payload && context.event.message.quick_reply.payload.includes('pollAnswerPropagate')) {
				// Tratando resposta da enquete através de propagação
				const payload = context.event.message.quick_reply.payload;
				const poll_question_option_id = payload.substr(payload.indexOf('_') + 1, payload.length);
				await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id, 'propagate');
				context.setState({ dialog: 'pollAnswer' });
			}
			// Tratando dados adicionais do recipient
			if (context.state.dialog === 'recipientData' && context.state.recipientData) {
				if (context.event.isQuickReply) {
					if (context.state.dataPrompt === 'email') {
						await context.setState({ email: context.event.message.quick_reply.payload });
					} else if (context.state.dataPrompt === 'end') {
						await context.setState({ cellphone: context.event.message.quick_reply.payload });
					}
				} else if (context.event.isText) {
					if (context.state.dataPrompt === 'email') {
						await context.setState({ email: context.event.message.text });
					} else if (context.state.dataPrompt === 'end') {
						await context.setState({ cellphone: context.event.message.text });
					}
				} if (context.event.isPostback) {
					if (context.state.dataPrompt === 'email') {
						await context.setState({ email: context.event.postback.payload });
					} else if (context.state.dataPrompt === 'end') {
						await context.setState({ cellphone: context.event.postback.payload });
					}
				}

				if (context.state.recipientData) {
					switch (context.state.recipientData) {
					case 'email':
						await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
							fb_id: context.session.user.id,
							email: context.state.email,
						});
						await context.sendButtonTemplate('Legal, agora quer me informar seu telefone, para lhe manter informado sobre outras perguntas?', opt.recipientData_YesNo);
						await context.setState({ recipientData: 'cellphonePrompt', dialog: 'recipientData', dataPrompt: '' });
						break;
					case 'cellphone':
						await context.setState({ cellphone: `+55${context.state.cellphone.replace(/[- .)(]/g, '')}` });
						if (phoneRegex.test(context.state.cellphone)) {
							await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
								fb_id: context.session.user.id,
								cellphone: context.state.cellphone,
							});
						} else {
							await context.setState({ dataPrompt: '', recipientData: 'cellphonePrompt' });
							await context.sendText('Desculpe-me, mas seu telefone não parece estar correto. Não esqueça de incluir o DDD. Por exemplo: 1199999-8888');
							await context.sendButtonTemplate('Vamos tentar de novo?', opt.recipientData_YesNo);
						}
						break;
					case 'cellphonePrompt':
						await context.setState({ dialog: 'recipientData', dataPrompt: 'cellphone' });
						break;
					}
				}
			}

			switch (context.state.dialog) {
			case 'greetings':
				await context.typingOff();
				areWeListening = true;
				await context.setState({ sendIntro: true, listening: true });
				await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
				await context.setState({ trajectory: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'trajectory') });
				await context.setState({ articles: getArticles(context.state.politicianData.gender) });
				await context.setState({ introduction: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction') });
				await context.setState({ issueMessage: getIssueMessage(await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_acknowledgment')) });
				await context.setState({ greeting: context.state.politicianData.greeting.replace('${user.office.name}', context.state.politicianData.office.name) }); // eslint-disable-line no-template-curly-in-string
				await context.setState({ greeting: context.state.greeting.replace('${user.name}', context.state.politicianData.name) }); // eslint-disable-line no-template-curly-in-string
				await context.sendText(context.state.greeting);
				await context.sendText(context.state.issueMessage);
				if (menuTimers[context.session.user.id]) { // clear timer if it already exists
					clearTimeout(menuTimers[context.session.user.id]);
				}
				menuTimers[context.session.user.id] = setTimeout(async () => { // wait 'MenuTimerlimit' to show options menu
					await context.setState({ optionPrompt: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'option_prompt') });
					await context.sendButtonTemplate(context.state.optionPrompt.content, await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption]));
					delete menuTimers[context.session.user.id]; // deleting this timer from timers object
				}, MenuTimerlimit);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'mainMenu':
				await context.typingOff();
				areWeListening = true;
				await context.setState({ sendIntro: true, listening: true });
				await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
				await context.setState({ trajectory: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'trajectory') });
				await context.setState({ articles: getArticles(context.state.politicianData.gender) });
				await context.setState({ introduction: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction') });
				await context.sendButtonTemplate(context.state.issueMessage, await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption]));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'chooseTheme':
				await context.sendText('Essa é uma pergunta bastante complexa! Me ajude a entender sobre o que você quer saber, escolha uma opção abaixo ⤵️',
					await attach.getQR(Object.keys(context.state.apiaiResp.result.parameters), 'option'));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'showAnswer':
				await context.sendText(context.state.question.answer);
				await context.sendButtonTemplate('E aí, o que achou? Se tiver mais alguma pergunta é só mandar!',
					await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption]));
				await context.setState({ whatWasTyped: '' });
				await context.setState({ dialog: 'prompt' });
				break;
			case 'NotOneOfThese':
				await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id,
					context.state.whatWasTyped, context.state.apiaiResp.result.parameters);
				await context.sendText('Que pena! Mas recebi sua dúvida e estarei te respondendo logo mais!');
				await context.sendButtonTemplate('E agora, como posso te ajudar?',
					await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption]));
				await context.setState({ whatWasTyped: '' });
				await context.setState({ dialog: 'prompt' });
				break;
			case 'intermediate':
				await context.sendText('Você gostaria de enviar uma mensagem para nossa equipe ou conhecer mais sobre '
						+ `${context.state.articles.defined} ${context.state.politicianData.office.name} ${context.state.politicianData.name}?`);
				await context.sendButtonTemplate('Selecione a opção desejada em um dos botões abaixo:', [opt.writeMessage, opt.seeAssistent]);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'votoLegal':
				await context.sendText('Estamos em campanha e contamos com você.');
				await context.sendButtonTemplate('Quer fazer parte?', opt.votoLegal_participateOptions);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'knowMore': {
				await context.sendButtonTemplate('Existem diversas formas de participar da construção de uma candidatura. '
						+ 'Posso ajudá-lo a realizar uma doação ou divulgar a campanha. Quer entender melhor?', [opt.AboutDonation, opt.AboutDivulgation, opt.goBackMainMenu]);
				await context.setState({ dialog: 'prompt' });
				break;
			}
			case 'aboutDonation':
				await context.sendText('Doar é importante para campanhas mais justas.');
				await context.sendText('Aqui no site, você pode doar por meio do cartão de crédito ou boleto bancário.');
				await context.sendButtonTemplate('Com o pagamento aprovado, enviaremos um recibo provisório por e-mail. Cada pessoa pode doar até 10% da renda declarada '
						+ 'referente ao ano anterior. O limite de doação diária é de R$ 1.064,10.', [opt.wannaDonate, opt.backToKnowMore]);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'aboutDivulgation':
				await context.setState({ participateOptions: [opt.leaveInfo] });
				if (context.state.politicianData.picframe_url) {
					await context.setState({
						participateOptions: context.state.participateOptions.concat([{
							type: 'web_url',
							url: context.state.politicianData.picframe_url,
							title: 'Mudar Avatar',
						}]),
					});
				}
				await context.setState({ participateOptions: context.state.participateOptions.concat([opt.backToKnowMore]) });
				await context.sendButtonTemplate('Para ajudar na divulgação, você pode deixar seus contatos comigo ou mudar sua imagem de avatar. Você quer participar?',
					context.state.participateOptions);
				await context.setState({ dialog: 'prompt', dataPrompt: 'email' });
				break;
			case 'WannaHelp':
				await context.setState({ participateOptions: [opt.wannaDonate] });
				// checking for picframe_url so we can only show this option when it's available but still show the votoLegal option
				if (context.state.politicianData.picframe_url) {
					await context.setState({ participateOptions: context.state.participateOptions.concat([opt.wannaDivulgate]) });
				}
				await context.setState({ participateOptions: context.state.participateOptions.concat([opt.goBackMainMenu]) });
				await context.sendButtonTemplate('Ficamos felizes com seu apoio! Como deseja participar?', context.state.participateOptions);
				await context.setState({ dialog: 'prompt', participateOptions: undefined });
				break;
			case 'WannaDonate':
				// if referral.source(CUSTOMER_CHAT_PLUGIN) doesn't exist we are on facebook and should send votolegal's url
				if (!context.event.rawEvent.postback.referral) {
					await context.setState({ wantToDonate: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'want_to_donate') });

					await context.setState({
						participateOptions: [
							{
								type: 'web_url',
								url: `${context.state.politicianData.votolegal_integration.votolegal_url}/#doar`,
								title: 'Quero doar!',
							}],
						participateMessage: '',
						anotherText: context.state.wantToDonate.content,
					});
				} else {
					await context.setState({
						participateOptions: [],
						participateMessage: 'Você já está na nossa página para doar. Se quiser, também poderá divulgar seu apoio!',
						anotherText: 'Seu apoio é fundamental para nossa campanha! Por isso, cuidamos da segurança de todos os doadores. ',
					});
				}
				// checking for picframe_url so we can only show this option when it's available but still show the votoLegal option
				if (context.state.politicianData.picframe_url) {
					await context.setState({ participateOptions: context.state.participateOptions.concat([opt.wannaDivulgate]) });
				} else {
					await context.setState({ participateOptions: context.state.participateOptions.concat([opt.leaveInfo]) });
					await context.setState({ dataPrompt: 'email' });
				}
				await context.setState({ participateOptions: context.state.participateOptions.concat([opt.goBackMainMenu]) });
				// await participateOptions.push(opt.goBackMainMenu);
				await context.sendText(context.state.anotherText);
				await context.setState({ valueLegal: await VotoLegalAPI.getVotoLegalValues(context.state.politicianData.votolegal_integration.votolegal_username) });
				if (context.state.participateMessage === '') {
					await context.setState({
						participateMessage: `Já consegui R$${formatReal(context.state.valueLegal.candidate.total_donated)} da minha meta de `
								+ `R$${formatReal(getMoney(context.state.valueLegal.candidate.raising_goal))}.`,
					});
				} else {
					await context.sendText(`Já consegui R$${formatReal(context.state.valueLegal.candidate.total_donated)} da minha meta de `
							+ `R$${formatReal(getMoney(context.state.valueLegal.candidate.raising_goal))}.`);
				}
				await context.sendButtonTemplate(context.state.participateMessage, context.state.participateOptions);
				await context.setState({
					dialog: 'prompt', valueLegal: undefined, participateOptions: undefined, participateMessage: undefined, anotherText: undefined,
				});
				break;
			case 'WannaDivulgate':
				await context.sendButtonTemplate('Que legal! Seu apoio é muito importante para nós! Você quer mudar foto (avatar) do seu perfil?', [
					{
						type: 'web_url',
						url: context.state.politicianData.picframe_url,
						title: 'Atualizar foto',
					},
					opt.wannaDonate,
					opt.goBackMainMenu,
				]);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'createIssue':
				if (context.state.listening === true) {
					if (!userMessages[context.session.user.id] || userMessages[context.session.user.id] === '') { // aggregating user texts
						userMessages[context.session.user.id] = context.state.whatWasTyped;
					} else {
						userMessages[context.session.user.id] = `${userMessages[context.session.user.id]} ${context.state.whatWasTyped}`;
					}
				}

				if (issueTimers[context.session.user.id]) { // clear timer if it already exists
					clearTimeout(issueTimers[context.session.user.id]);
					await context.typingOn(); // show user that we are listening
				} else if (context.state.sendIntro === true) { // -> we didn't understand the message
					await context.setState({ issueStartedListening: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_started_listening') });
					await context.sendText(context.state.issueStartedListening.content);
				} else { // -> user wants to contact us
					await context.sendText('Que legal! Para entrar em contato conosco, digite e mande sua mensagem!');
					userMessages[context.session.user.id] = '';
					await context.setState({ sendIntro: true, listening: true });
				}

				issueTimers[context.session.user.id] = setTimeout(async () => {
					if (userMessages[context.session.user.id] !== '') {
						await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id, userMessages[context.session.user.id],
							context.state.apiaiResp.result.parameters);
						console.log('Enviei', userMessages[context.session.user.id]);
						await context.setState({ sendIntro: true, listening: true });
						await context.typingOff();
						delete issueTimers[context.session.user.id]; // deleting this timer from timers object
						delete userMessages[context.session.user.id]; // deleting last sent message

						postIssueTimers[context.session.user.id] = setTimeout(async () => { // creating confirmation timer (will only be shown if user doesn't change dialog
							await context.setState({ issueCreatedMessage: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_created') });
							await context.sendButtonTemplate(context.state.issueCreatedMessage.content,
								await checkMenu(context, [opt.trajectory, opt.contacts, opt.doarOption]));
						}, 5);
					}
				}, IssueTimerlimit);
				break;
			case 'aboutMe': {
				const introductionText = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction');
				await context.sendText(introductionText.content);
				await context.sendButtonTemplate(`O que mais deseja saber sobre ${context.state.articles.defined} ${context.state.politicianData.office.name}?`,
					await checkMenu(context, [opt.trajectory, opt.contacts, opt.doarOption]));
				await context.setState({ dialog: 'prompt' });
				break;
			}
			case 'contacts':
				// Tratando o formato do telefone
				if (context.state.politicianData.contact.cellphone) {
					await context.setState({ politicianCellPhone: context.state.politicianData.contact.cellphone.replace(/(?:\+55)+/g, '') });
					await context.setState({ politicianCellPhone: context.state.politicianCellPhone.replace(/^(\d{2})/g, '($1)') });
				}
				await context.sendText(`Você pode entrar em contato com ${context.state.articles.defined} ${context.state.politicianData.office.name} `
						+ `${context.state.politicianData.name} pelos seguintes canais:`);
				if (context.state.politicianData.contact.email) {
					await context.sendText(` - Através do e-mail: ${context.state.politicianData.contact.email}`);
				}
				if (context.state.politicianData.contact.cellphone) {
					await context.sendText(` - Através do WhatsApp: ${context.state.politicianCellPhone}`);
				}
				if (context.state.politicianData.contact.twitter) {
					await context.sendText(` - Através do Twitter: ${context.state.politicianData.contact.twitter}`);
				}
				if (context.state.politicianData.contact.url) {
					await context.sendText(` - Através do site: ${context.state.politicianData.contact.url}`);
				}
				await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.trajectory, opt.poll_suaOpiniao, opt.doarOption]));
				await context.setState({ dialog: 'prompt', politicianCellPhone: undefined });
				break;
			case 'poll': {
				if (await checkPollAnswered() === true) {
					await context.sendText('Ah, que pena! Você já respondeu essa pergunta.');
					await context.sendButtonTemplate('Se quiser, eu posso te ajudar com outra coisa.',
						await checkMenu(context, [opt.trajectory, opt.contacts, opt.doarOption]));
					await context.setState({ dialog: 'prompt' });
				} else {
					await context.sendText('Quero conhecer você melhor. Deixe sua resposta e participe deste debate.');
					await context.sendText(`Pergunta: ${context.state.pollData.questions[0].content}`, {
						quick_replies: [
							{
								content_type: 'text',
								title: context.state.pollData.questions[0].options[0].content,
								payload: `${context.state.pollData.questions[0].options[0].id}`,
							},
							{
								content_type: 'text',
								title: context.state.pollData.questions[0].options[1].content,
								payload: `${context.state.pollData.questions[0].options[1].id}`,
							},
						],
					});
					await context.typingOff();
					await context.setState({ dialog: 'pollAnswer' });
				}
				break;
			}
			case 'pollAnswer':
				await context.sendButtonTemplate('Muito obrigado por sua resposta. Você gostaria de deixar seu e-mail e telefone para nossa equipe?', opt.recipientData_LetsGo);
				await context.setState({ dialog: 'prompt', dataPrompt: 'email' });
				break;
			case 'recipientData':
				if (context.event.postback && (context.event.postback.title === 'Agora não' || context.event.postback.title === 'Não')) {
					await context.sendButtonTemplate('Está bem! Posso te ajudar com mais alguma informação?',
						await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption]));
					await context.setState({ dialog: 'prompt' });
				} else if (context.state.dataPrompt) {
					switch (context.state.dataPrompt) {
					case 'email':
						try {
							// await context.sendText('Qual o seu e-mail?');
							await context.sendText('Qual o seu e-mail? Pode digita-lo e nos mandar.', { quick_replies: [{ content_type: 'user_email' }] });
						} catch (err) {
							console.log('E-mail button catch error =>', err);
							await context.sendText('Qual o seu e-mail?');
						} finally {
							await context.setState({ dialog: 'recipientData', recipientData: 'email' });
						}
						break;
					case 'cellphone':
						try {
							await context.sendText('Qual é o seu telefone? Não deixe de incluir o DDD.');
							// await context.sendText("Qual é o seu telefone? Não deixe de incluir o DDD.", {
							// quick_replies: [{ content_type: 'user_phone_number' }]});
						} catch (err) {
							console.log('Cellphone button catch error =>', err);
							await context.sendText('Qual é o seu telefone? Não deixe de incluir o DDD.');
						} finally {
							await context.setState({ dialog: 'recipientData', recipientData: 'cellphone', dataPrompt: 'end' });
						}
						break;
					case 'cellphoneFail':
						break;
					case 'end':
						await context.sendText('Pronto, já guardei seus dados.');
						try {
							await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption]));
						} catch (err) {
							await context.sendButtonTemplate('Como posso te ajudar?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.doarOption]));
						}
						await context.setState({ dialog: 'prompt', recipientData: '', dataPrompt: '' });
						break;
					}
				}
				break;
			case 'trajectory':
				await context.sendText(context.state.trajectory.content);
				await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.poll_suaOpiniao, opt.contacts, opt.doarOption]));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'issue':
				await context.sendText('Escreva sua mensagem para nossa equipe:');
				await context.setState({ dialog: 'prompt', prompt: 'issue' });
				break;
			case 'issue_created': {
				const issue_created_message = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_created');
				await context.sendButtonTemplate(issue_created_message.content, [opt.backToBeginning]);
				await context.setState({ dialog: 'prompt' });
				break;
			}
			}
		}
	})
	.onError(async (context, err) => {
		const date = new Date();
		console.log('\n');
		console.log(`Parece que aconteceu um erro as ${date.toLocaleTimeString('pt-BR')} de ${date.getDate()}/${date.getMonth() + 1} =>`);
		console.log(err);
		if (context.event.rawEvent.field === 'feed') {
			if (context.event.rawEvent.value.item === 'comment' || context.event.rawEvent.value.item === 'post') {
				// we update user data at every interaction that's not a comment or a post
				await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
				await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
			}
		} else {
			await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
			await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
		}
		console.log(`Usuário => ${context.session.user.first_name} ${context.session.user.last_name}`);
		console.log(`Administrador => ${context.state.politicianData.office.name} ${context.state.politicianData.name}`);

		await context.setState({ articles: getArticles(context.state.politicianData.gender) });
		await context.sendText('Olá. Você gostaria de enviar uma mensagem para nossa equipe ou conhecer mais sobre '
			+ `${context.state.articles.defined} ${context.state.politicianData.office.name} ${context.state.politicianData.name}?`);
		await context.sendButtonTemplate('Selecione a opção desejada em um dos botões abaixo:', [opt.writeMessage, opt.seeAssistent]);
		await context.setState({ dialog: 'prompt' });
	});


bot.onEvent(handler);

const server = createServer(bot, { verifyToken: config.verifyToken });

server.listen(process.env.API_PORT, () => {
	console.log(`Server is running on ${process.env.API_PORT} port...`);
});
