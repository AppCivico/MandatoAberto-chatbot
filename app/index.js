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
const dictionary = require('./utils/dictionary');
const audio = require('./utils/audio');

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

// TODO: pollTimer falta enviar o put
// TODO: add to blacklist should have politician_id and user_id?
// TODO: remove from blacklist is a different endpoint?

const IssueTimerlimit = 1000 * 20; // 20 seconds -> listening to user doubts -> 1000 * 20
const MenuTimerlimit = 1000 * 60; // 60 seconds -> waiting to show the initial menu -> 1000 * 60
// const pollTimerlimit = 1000 * 60 * 60 * 2; // 2 hours -> waiting to send poll -> 1000 * 60 * 60 * 2

const issueTimers = {};
const postIssueTimers = {};
const menuTimers = {};
// const pollTimers = {};
// timers -> object that stores timers. Each user_id stores it's respective timer.
// issueTimers -> stores timers that creates issues
// postIssueTimers -> stores timers that confirm to the user that we have sent his "issue"
// menuTimers -> stores timers that show to the user the initial menu
// pollTimers -> stores timers that send unanswered poll to user after n hours (starts at 'GET_STARTED')

const userMessages = {};
// userMessages -> stores user messages from issues. We can't use a regular state for this because the timer can't save state "after session has been written"
const listening = {};
// listening = true -> verifies if we should aggregate text on userMessages
let areWeListening = true; // eslint-disable-line
// areWeListening -> user.state.areWeListening(doesn't work) -> diferenciates messages that come from the standard flow and messages from comment/post

function getRandom(myArray) { return myArray[Math.floor(Math.random() * myArray.length)]; }

// removes every empty intent object and returns the intents as an array
function removeEmptyKeys(obj) {
	Object.keys(obj).forEach((key) => {
		if (obj[key].length === 0) {
			delete obj[key];
		}
		if (obj === 'Falso') {
			delete obj[key];
		}
	});
	return Object.keys(obj);
}

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

bot.use(withTyping({ delay: 1000 * 2 }));

async function loadOptionPrompt(context) {
	if (!context.state.optionPrompt || context.state.optionPrompt === '') {
		const answer = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'option_prompt');
		if (!answer || (answer || !answer.content) || (answer || answer.content || answer.content === '')) {
			return 'Que tal escolher uma das opções abaixo? Ou digite sua pergunta e nos mande!';
		}
		return answer.content;
	}
	return context.state.optionPrompt;
}

async function loadIssueStarted(context) {
	const answer = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_started_listening');
	if (!answer || (answer || !answer.content) || (answer || answer.content || answer.content === '')) {
		return 'Que legal! Digite o que quer dizer abaixo!';
	}
	return answer.content;
}

// Deve-se indentificar o sexo do representante público e selecionar os artigos (definido e possesivo) adequados
function getArticles(gender) {
	if (gender === 'F') {
		return Articles.feminine;
	}
	return Articles.masculine;
}

async function getArtigoCargoNome(context) {
	if (!context.state.articles) { // check if we are missing the articles and reload them
		await context.setState({ articles: await getArticles(context.state.politicianData.gender) });
	}
	return `${context.state.articles.defined} ${context.state.politicianData.office.name} ${context.state.politicianData.name}`;
}


async function listThemes(obj) {
	let themes = [];
	await Object.keys(obj).forEach(async (element) => {
		if (dictionary[obj[element]]) { // checks if there is a dictionary entry for element
			themes.push(dictionary[obj[element]].toLowerCase());
		} else {
			themes.push(obj[element].toLowerCase().replace('_', ' ')); // remove upper case and underscore just to be safe
		}
	});
	themes = themes.sort().join(', ').replace(/,(?=[^,]*$)/, ' e');
	return themes.length > 0 ? themes : 'esses assuntos';
}

async function checkPollAnswered(context) {
	const recipientAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, context.state.pollData.id);
	if (recipientAnswer.recipient_answered >= 1) {
		return true;
	}
	return false;
}

// async function sendToCreateIssue(context) { // before we can use this we need to fix the comment/post status issue
// 	console.log('Status do arewelistening:', areWeListening);
// 	if (areWeListening === true) {
// 		await context.setState({ dialog: 'createIssue' });
// 	} else {
// 		await context.setState({ dialog: 'intermediate' });
// 		areWeListening = true;
// 	}
// }

async function checkMenu(context, dialogs) { // eslint-disable-line no-inner-declarations
	if (!context.state.introduction) { // just in case something goes way off
		await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
		await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
	}
	if (context.state.introduction && !context.state.introduction.content) { dialogs = dialogs.filter(obj => obj.payload !== 'aboutMe'); }
	if (!context.state.trajectory) { dialogs = dialogs.filter(obj => obj.payload !== 'trajectory'); }
	if (!context.state.pollData) { dialogs = dialogs.filter(obj => obj.payload !== 'poll'); }
	if (!context.state.politicianData.contact) { dialogs = dialogs.filter(obj => obj.payload !== 'contacts'); }
	if (dialogs.find(x => x.payload === 'poll')) {
		if (await checkPollAnswered(context) === true) { // already answered so we remove option
			dialogs = await dialogs.filter(obj => obj.payload !== 'poll');
			await dialogs.push(opt.talkToUs);
		}
	}
	return dialogs;
}

async function checkPosition(context) {
	// await context.setState({ dialog: 'prompt' });

	switch (context.state.intentName) {
	case 'Pergunta':
		await context.setState({ dialog: 'prompt' });
		await context.setState({ entities: await removeEmptyKeys(context.state.resultParameters) });
		// console.log(context.state.entities);
		if (context.state.entities.length >= 1) { // at least one entity
			await context.setState({ // getting knowledge base
				knowledge: await MandatoAbertoAPI.getknowledgeBase(context.state.politicianData.user_id, context.state.resultParameters),
			});
			// before sending the themes we check if there is anything on them, if there isn't we send 'esses assuntos'
			await context.setState({ currentThemes: await listThemes(context.state.entities) }); // format themes
			// console.log('currentThemes', context.state.currentThemes);

			// console.log('knowledge:', context.state.knowledge);
			// check if there's at least one answer in knowledge_base
			if (context.state.knowledge && context.state.knowledge.knowledge_base && context.state.knowledge.knowledge_base.length >= 1) {
				await context.sendButtonTemplate('Você está perguntando meu posicionamento sobre ' // confirm themes with user
						+ `${context.state.currentThemes}?`, opt.themeConfirmation);
			} else { // no answers in knowledge_base (We know the entity but politician doesn't have a position)
				// await context.sendText(`Parece que ${getArtigoCargoNome(context)} ainda não se posicionou sobre `
				// + `${context.state.currentThemes}. Estarei avisando a nossa equipe e te respondendo.`);
				await context.sendText(`🤔 Eu ainda não perguntei para ${await getArtigoCargoNome(context)} sobre `
						+ `${context.state.currentThemes}. Irei encaminhar para nossa equipe, está bem?`);
				await context.sendButtonTemplate(await loadOptionPrompt(context),
						await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));// eslint-disable-line
				await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id,
					context.state.whatWasTyped, context.state.resultParameters);
			}
		} else { // dialogFlow knows it's a question but has no entities //  o você acha do blablabla?
			await context.sendText(`Parece que ${await getArtigoCargoNome(context)} ainda não se posicionou sobre esse assunto. `
					+ 'Estarei avisando a nossa equipe e te responderemos em breve.');
			await context.sendButtonTemplate(await loadOptionPrompt(context),
					await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));// eslint-disable-line

			await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id,
				context.state.whatWasTyped, context.state.resultParameters);
		}
		break;
	case 'Saudação':
		await context.setState({ dialog: 'greetings' });
		break;
	case 'Trajetoria':
		await context.setState({ dialog: 'trajectory' });
		break;
	case 'Voluntário':
		await context.setState({ dialog: 'participateMenu' });
		break;
	case 'Fallback': // didn't understand what was typed
		// falls throught
	default: // any new intent that gets added to dialogflow but it's not added here will also act like 'Fallback'
		await context.sendText(getRandom(opt.frases_fallback));
		await context.sendButtonTemplate(await loadOptionPrompt(context),
				await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));// eslint-disable-line
		break;
	}
}

const handler = new MessengerHandler()
	.onEvent(async (context) => { // eslint-disable-line
		if (!context.event.isDelivery && !context.event.isEcho && !context.event.isRead && context.event.rawEvent.field !== 'feed') {
			await context.typingOn();

			console.log('context', context);


			// we reload politicianData on every useful event
			// we update context data at every interaction that's not a comment or a post
			await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
			await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });

			if (context.state.dialog !== 'recipientData' && context.state.dialog !== 'pollAnswer') { // handling input that's not from "asking data" or answering poll (obs: 'pollAnswer' from timer will bypass this)
				if (context.event.isPostback) {
					// we are not listening anymore if user clicks on persistent menu during the listening
					if (listening[context.session.user.id]) { delete listening[context.session.user.id]; }
					// user confirms that theme(s) is/are correct
					if (context.event.postback.payload === 'themeYes') {
						await context.setState({ trigger: false });
						/* eslint-disable */
						for (const [element] of Object.entries(context.state.resultParameters)) { // eslint-disable-line no-restricted-syntax
							const currentTheme = await context.state.knowledge.knowledge_base.find(x => x.entities[0].tag === element);
							// check if there's either a text answer or a media attachment linked to current theme
							if (currentTheme && (currentTheme.answer || (currentTheme.saved_attachment_type !== null && currentTheme.saved_attachment_id !== null))) {
								if (currentTheme.answer) { // if there's a text asnwer we send it
									await context.sendText(`Sobre ${dictionary[element].toLowerCase()}: ${currentTheme.answer}`);
								}
								if (currentTheme.saved_attachment_type === 'image') { // if attachment is image
									await context.sendImage({ attachment_id: currentTheme.saved_attachment_id });
								} else if (currentTheme.saved_attachment_type === 'video') { // if attachment is video
									await context.sendVideo({ attachment_id: currentTheme.saved_attachment_id });
								} else if (currentTheme.saved_attachment_type === 'audio') { // if attachment is audio
									await context.sendAudio({ attachment_id: currentTheme.saved_attachment_id });
								}
							} else { // we couldn't find neither text answer nor attachment
								await context.sendText(`Sobre ${dictionary[element].toLowerCase()} fico te devendo uma resposta. `
									+ 'Mas já entou enviando para nossas equipe e estaremos te respondendo em breve.');
								if (context.state.trigger === false) {
									await context.setState({ trigger: true });
									await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id,
										context.state.whatWasTyped, context.state.resultParameters);
								}
							}
						}
						/* eslint-enable */
						await context.sendButtonTemplate(await loadOptionPrompt(context),
							await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
						await context.setState({ // cleaning up
							apiaiResp: '', knowledge: '', themes: '', whatWasTyped: '', trigger: '',
						});
					} else if (context.event.postback.payload.slice(0, 6) === 'answer') {
						await context.setState({ question: context.state.knowledge.knowledge_base.find(x => x.id === parseInt(context.event.postback.payload.replace('answer', ''), 10)) });
						await context.setState({ dialog: 'showAnswer' });
					} else if (context.event.postback.payload === 'talkToUs') { // user wants to enter in contact
						delete userMessages[context.session.user.id]; // deleting last sent message (it was sent already)
						await context.setState({ dialog: 'createIssue' });
					} else {
						console.log('payload => ', context.event.postback.payload);
						await context.setState({ dialog: context.event.postback.payload });
					}
				} else if (context.event.isQuickReply) {
					const { payload } = context.event.message.quick_reply;
					if (payload.slice(0, 4) === 'poll') { // user answered poll that came from timer
						await context.setState({ dialog: 'pollAnswer' });
					} else {
						await context.setState({ dialog: payload });
					}
				} else if (context.event.isAudio) {
					await context.sendText('Áudio? Me dê um instante para processar.');
					if (context.event.audio.url) {
						// await context.setState({ audio: await audio.voiceRequest('https://cdn.fbsbx.com/v/t59.3654-21/41422332_1965526987077956_6964334129533943808_n.mp4/audioclip-1536591135000-2694.mp4?_nc_cat=0&oh=4eed936c79d2011ca51995370fe1b718&oe=5B998567', context.session.user.id) });
						await context.setState({ audio: await audio.voiceRequest(context.event.audio.url, context.session.user.id) });
						if (context.state.audio.txtMag && context.state.audio.txtMag !== '') { // there was an error (or the user just didn't say anything)
							await context.sendButtonTemplate(context.state.audio.txtMag,
								await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));// eslint-disable-line
						} else {
							await context.setState({ whatWasTyped: context.state.audio.whatWasSaid });
							await context.setState({ resultParameters: context.state.audio.parameters });
							await context.setState({ intentName: context.state.audio.intentName });
							await checkPosition(context);
						}
					}
				} else if (context.event.isText) {
					if (!listening[context.session.user.id]) { // if we are listening we don't try to interpret the text
						// will be used in case the bot doesn't find the question
						await context.setState({ whatWasTyped: context.event.message.text });
						await context.setState({ apiaiResp: await apiai.textRequest(context.state.whatWasTyped, { sessionId: context.session.user.id }) });
						// console.log('recebi um texto');
						// console.log('IntentNme ', context.state.apiaiResp.result.metadata.intentName);

						await context.setState({ resultParameters: context.state.apiaiResp.result.parameters });
						await context.setState({ intentName: context.state.apiaiResp.result.metadata.intentName });
						await checkPosition(context);
					} // end if listening
				} // end if isText
			}
		}


		if (context.session) {
			// if the user interacts while this timer is running we don't need to show the menu anymore
			if (menuTimers[context.session.user.id]) { clearTimeout(menuTimers[context.session.user.id]); delete menuTimers[context.session.user.id]; }

			// if the user interacts while this timer is running we don't need to run confirm that the issue was sent anymore
			if (postIssueTimers[context.session.user.id]) { clearTimeout(menuTimers[context.session.user.id]); delete postIssueTimers[context.session.user.id]; }
		}
		if (context.event.rawEvent.postback) {
			if (context.event.rawEvent.postback.referral) { // if this exists we are on external site
				await context.setState({ facebookPlataform: 'CUSTOMER_CHAT_PLUGIN' });
			} else { // if it doesn't exists we are on an facebook/messenger
				await context.setState({ facebookPlataform: 'MESSENGER' });
			}
		}
		await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
			fb_id: context.session.user.id,
			name: `${context.session.user.first_name} ${context.session.user.last_name}`,
			gender: context.session.user.gender === 'male' ? 'M' : 'F',
			origin_dialog: 'greetings',
			picture: context.session.user.profile_pic,
			session: JSON.stringify(context.state),
		});

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

			// Tratando botão GET_STARTED
			if (context.event.postback && context.event.postback.payload === 'greetings') {
				// await context.resetState();

				await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
				await context.setState({ dialog: 'greetings' });
				// pollTimers[context.session.user.id] = setTimeout(async () => { // create pollTimer for user
				// 	// checks if user already answered poll (if he did, there's no reason to send it. In this case should be !== true)
				// 	if (await checkPollAnswered(context) !== true // also check if there's at least one question
				// 		&& (context.state.pollData && context.state.pollData.questions && context.state.pollData.questions.length > 0)) {
				// 		// send update to api (user already received this poll)
				// 		await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
				// 			fb_id: context.session.user.id,
				// 			poll_notification_sent: true,
				// 		});
				// 		await context.sendText('Quero conhecer você melhor. Deixe sua resposta e participe deste debate.');
				// 		await context.sendText(`Pergunta: ${context.state.pollData.questions[0].content}`, {
				// 			quick_replies: [
				// 				{
				// 					content_type: 'text',
				// 					title: context.state.pollData.questions[0].options[0].content,
				// 					payload: `poll${context.state.pollData.questions[0].options[0].id}`, // notice 'poll'
				// 				},
				// 				{
				// 					content_type: 'text',
				// 					title: context.state.pollData.questions[0].options[1].content,
				// 					payload: `poll${context.state.pollData.questions[0].options[1].id}`, // notice 'poll'
				// 				},
				// 			],
				// 		});
				// 		await context.typingOff();
				// 		await context.setState({ dialog: 'pollAnswer' }); // doesn't really work, we will be using the 'poll' text on the options's payloads to react correctly
				// 	}
				// 	delete pollTimers[context.session.user.id];
				// }, pollTimerlimit);
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
				// if (pollTimers[context.session.user.id]) {
				// 	delete pollTimers[context.session.user.id];
				// }
				if (context.event.message.quick_reply.payload.slice(0, 4) === 'poll') {
					await context.setState({ answer: context.event.message.quick_reply.payload.replace('poll', '') });
				} else {
					await context.setState({ answer: context.event.message.quick_reply.payload });
				}
				await MandatoAbertoAPI.postPollAnswer(context.session.user.id, context.state.answer, 'dialog');
				await context.setState({ answer: '' });
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
				await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
				await context.setState({ trajectory: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'trajectory') });
				await context.setState({ articles: await getArticles(context.state.politicianData.gender) });
				await context.setState({ introduction: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction') });
				await context.setState({ greeting: context.state.politicianData.greeting.replace('${user.office.name}', context.state.politicianData.office.name) }); // eslint-disable-line no-template-curly-in-string
				await context.setState({ greeting: context.state.greeting.replace('${user.name}', context.state.politicianData.name) }); // eslint-disable-line no-template-curly-in-string
				await context.sendText(context.state.greeting);
				if (menuTimers[context.session.user.id]) { // clear timer if it already exists
					clearTimeout(menuTimers[context.session.user.id]);
				}
				menuTimers[context.session.user.id] = setTimeout(async () => { // wait 'MenuTimerlimit' to show options menu
					await context.sendButtonTemplate(await loadOptionPrompt(context),
						await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
					delete menuTimers[context.session.user.id]; // deleting this timer from timers object
				}, MenuTimerlimit);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'mainMenu':
				await context.typingOff();
				areWeListening = true;
				await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
				await context.setState({ trajectory: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'trajectory') });
				await context.setState({ articles: await getArticles(context.state.politicianData.gender) });
				await context.setState({ introduction: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction') });
				await context.sendButtonTemplate(await loadOptionPrompt(context), await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'NotOneOfThese': // user said "no" on theme confirmation
				if (menuTimers[context.session.user.id]) { delete menuTimers[context.session.user.id]; } // for safety reasons
				await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id,
					context.state.whatWasTyped, context.state.resultParameters);
				await context.sendText('Que pena! Parece que eu errei. Mas recebi sua dúvida e estaremos te respondendo logo mais! Quer fazer outra pergunta?');
				menuTimers[context.session.user.id] = setTimeout(async () => { // wait 'MenuTimerlimit' to show options menu
					await context.sendButtonTemplate(await loadOptionPrompt(context),
						await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
					delete menuTimers[context.session.user.id]; // deleting this timer from timers object
				}, (MenuTimerlimit / 2));
				await context.setState({ whatWasTyped: '', dialog: 'prompt' });
				break;
			case 'checkPosition':
				// replaced by a function.
				break;
			case 'intermediate':
				await context.sendText('Você gostaria de enviar uma mensagem para nossa equipe ou conhecer mais sobre '
						+ `${context.state.articles.defined} ${context.state.politicianData.office.name} ${context.state.politicianData.name}?`);
				await context.sendButtonTemplate('Selecione a opção desejada em um dos botões abaixo:', [opt.writeMessage, opt.seeAssistent]);
				await context.setState({ dialog: 'prompt' });
				break;
			case 'participateMenu': // participar
				await context.setState({ participateText: 'Estamos em campanha e contamos com você.\n' }); // getting the first part of the text

				if (context.state.politicianData.votolegal_integration && context.state.politicianData.votolegal_integration.votolegal_url) {
					// check if politician is on votoLegal so we can info and option
					// if referral.source(CUSTOMER_CHAT_PLUGIN) exists we are outside facebook and shouldn't send votolegal's url
					if ((context.event.rawEvent.postback && context.event.rawEvent.postback.referral) || (context.event.rawEvent.message && context.event.rawEvent.message.tags
							&& context.event.rawEvent.message.tags.source && context.event.rawEvent.message.tags.source === 'customer_chat_plugin')) {
						await context.sendText(`${context.state.participateText}Você já está na nossa página para doar. Se quiser, também poderá divulgar seu apoio!`);
						await context.sendText('Seu apoio é fundamental para nossa campanha! Por isso, cuidamos da segurança de todos os doadores.');
					} else {
						await context.setState({ valueLegal: await VotoLegalAPI.getVotoLegalValues(context.state.politicianData.votolegal_integration.votolegal_username) });
						await context.setState({
							participateText: `${context.state.participateText}Já consegui R$${formatReal(context.state.valueLegal.candidate.total_donated)} da minha meta de `
									+ `R$${formatReal(getMoney(context.state.valueLegal.candidate.raising_goal))}.`,
						});
						await context.sendButtonTemplate(`${context.state.participateText}Apoie nossa campanha de arrecadação.`, [{
							type: 'web_url',
							url: `${context.state.politicianData.votolegal_integration.votolegal_url}/#doar`,
							title: 'Quero doar!',
						}]);
					}
				} else { // no votoLegal
					await context.sendText(context.state.participateText);
				}
				// check if there is a share obj so we can show the option
				if (context.state.politicianData.share && context.state.politicianData.share.url && context.state.politicianData.share.text) {
					await context.sendButtonTemplate(context.state.politicianData.share.text, [{
						type: 'web_url',
						url: context.state.politicianData.share.url,
						title: 'Divulgar',
					}]);
				}
				await context.sendButtonTemplate('Deixe seus contatos conosco para não perder as novidades.', [opt.leaveInfo, opt.backToBeginning]);
				await context.setState({ dialog: 'prompt', dataPrompt: 'email' });
				break;
			case 'createIssue': // will only happen if user clicks on 'Fale Conosco'
				if (listening[context.session.user.id] === true) { // if we are 'listening' we need to aggregate every message the user sends
					userMessages[context.session.user.id] = `${userMessages[context.session.user.id]}${context.state.whatWasTyped} `;
				} else { // we are not 'listening' -> it's the first time the user gets here
					await context.setState({ issueStartedListening: await loadIssueStarted(context) });
					await context.sendText(context.state.issueStartedListening);
					listening[context.session.user.id] = true;
					await context.typingOn();
					userMessages[context.session.user.id] = ''; // starting the userMessage
				}

				if (issueTimers[context.session.user.id]) { // check if timer already exists, and delete it if it does
					clearTimeout(issueTimers[context.session.user.id]);
					await context.typingOn(); // show user that we are listening
				}

				// create new (or reset) timer for sending message
				issueTimers[context.session.user.id] = setTimeout(async () => {
					if (userMessages[context.session.user.id] !== '') { // check if there's a message to send
						await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id, userMessages[context.session.user.id],
							context.state.resultParameters);
						// console.log('Enviei ', userMessages[context.session.user.id]);
						await context.typingOff();
						delete issueTimers[context.session.user.id]; // deleting this timer from timers object
					}
					delete listening[context.session.user.id];
				}, IssueTimerlimit);

				if (postIssueTimers[context.session.user.id]) { // check if timer already exists, and delete it if it does
					clearTimeout(postIssueTimers[context.session.user.id]);
				}
				// create new (or reset) timer for confirmation timer (will only be shown if user doesn't change dialog
				postIssueTimers[context.session.user.id] = setTimeout(async () => {
					if (!userMessages[context.session.user.id] || userMessages[context.session.user.id] === '') {
						await context.sendButtonTemplate('Não tem nenhuma mensagem para nossa equipe? Se tiver, clique em "Fale Conosco" e escreva sua mensagem.',
							await checkMenu(context, [opt.contacts, opt.participate, opt.talkToUs]));
					} else {
						await context.setState({ issueCreatedMessage: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_created') });
						await context.sendButtonTemplate(context.state.issueCreatedMessage.content,
							await checkMenu(context, [opt.keepWriting, opt.backToBeginning]));
					}
				}, IssueTimerlimit + 2);
				break;
			case 'aboutMe': {
				const introductionText = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction');
				await context.sendText(introductionText.content);
				await context.sendButtonTemplate(`O que mais deseja saber sobre ${context.state.articles.defined} ${context.state.politicianData.office.name}?`,
					await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));
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
				await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.trajectory, opt.poll_suaOpiniao, opt.participate]));
				await context.setState({ dialog: 'prompt', politicianCellPhone: undefined });
				break;
			case 'poll': {
				if (await checkPollAnswered(context) === true) {
					await context.sendText('Ah, que pena! Você já respondeu essa pergunta.');
					await context.sendButtonTemplate('Se quiser, eu posso te ajudar com outra coisa.',
						await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));
					await context.setState({ dialog: 'prompt' });
				} else if (context.state.pollData && context.state.pollData.questions && context.state.pollData.questions[0] && context.state.pollData.questions[0].content) {
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
				} else {
					await context.sendText('Não temos nenhuma pergunta ativa no momento.');
					await context.sendButtonTemplate('Se quiser, eu posso te ajudar com outra coisa.',
						await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));
				}
				break;
			}
			case 'pollAnswer':
				if (context.state.sentPersonalData !== true) {
					await context.sendButtonTemplate('Muito obrigado por sua resposta. Você gostaria de deixar seu e-mail e telefone para nossa equipe?', opt.recipientData_LetsGo);
					await context.setState({ dialog: 'prompt', dataPrompt: 'email' });
				} else { // if it's true, user already sent his personal data
					await context.sendButtonTemplate('Muito obrigado por sua resposta. Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.talkToUs, opt.participate]));
				}
				break;
			case 'recipientData':
				if (context.event.postback && (context.event.postback.title === 'Agora não' || context.event.postback.title === 'Não')) {
					await context.sendButtonTemplate('Está bem! Posso te ajudar com mais alguma informação?',
						await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
					await context.setState({ dialog: 'prompt' });
				} else if (context.state.dataPrompt) {
					switch (context.state.dataPrompt) {
					case 'email':
						try {
							await context.sendText('Qual o seu e-mail?');
							// await context.sendText('Qual o seu e-mail? Pode digita-lo e nos mandar.', { quick_replies: [{ content_type: 'user_email' }] });
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
						await context.setState({ sentPersonalData: true });
						try {
							await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
						} catch (err) {
							await context.sendButtonTemplate('Como posso te ajudar?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.participate]));
						}
						await context.setState({ dialog: 'prompt', recipientData: '', dataPrompt: '' });
						break;
					}
				}
				break;
			case 'trajectory':
				await context.sendText(context.state.trajectory.content);
				await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.poll_suaOpiniao, opt.contacts, opt.participate]));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'add_blacklist': // adding user to the blacklist from the persistent menu
				await MandatoAbertoAPI.updateBlacklist(context.session.user.id, 0);
				await context.sendText('Tudo bem. Não te enviaremos mais nenhuma notificação.');
				await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.participate]));
				break;
			case 'remove_blacklist': // removing user to the blacklist from the persistent menu
				await MandatoAbertoAPI.updateBlacklist(context.session.user.id, 1);
				await context.sendText('Legal. Estaremos te avisando das novidades.');
				await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.participate]));
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
			} // end switch de diálogo
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
		if (context.session.user && context.session.user.first_name && context.session.user.last_name) {
			console.log(`Usuário => ${context.session.user.first_name} ${context.session.user.last_name}`);
		} else {
			console.log('Usuário => Não conseguimos descobrir o nome do cidadão');
		}
		if (context.state && context.state.politicianData && context.state.politicianData.name
			&& context.state.politicianData.office && context.state.politicianData.office.name) {
			console.log(`Administrador => ${context.state.politicianData.office.name} ${context.state.politicianData.name}`);
		} else {
			console.log('Administrador => Não conseguimos descobrir o nome do político');
		}


		await context.sendButtonTemplate('Erro: Escreva uma mensagem para nós!', await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
		await context.setState({ dialog: 'prompt' });
		// await context.setState({ articles: getArticles(context.state.politicianData.gender) });
		// await context.sendText('Olá. Você gostaria de enviar uma mensagem para nossa equipe ou conhecer mais sobre '
		// 	+ `${context.state.articles.defined} ${context.state.politicianData.office.name} ${context.state.politicianData.name}?`);
		// await context.sendButtonTemplate('Selecione a opção desejada em um dos botões abaixo:', [opt.writeMessage, opt.seeAssistent]);
		// await context.setState({ dialog: 'prompt' });
	});


bot.onEvent(handler);

const server = createServer(bot, { verifyToken: config.verifyToken });

server.listen(process.env.API_PORT, () => {
	console.log(`Server is running on ${process.env.API_PORT} port...`);
});
