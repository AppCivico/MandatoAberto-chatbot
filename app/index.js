require('dotenv').config();

const {
	MessengerBot, FileSessionStore, withTyping, MessengerHandler,
} = require('bottender');
const { createServer } = require('bottender/restify');
const dialogFlow = require('apiai-promise');
const fse = require('fs-extra');

const config = require('./bottender.config.js').messenger;
const MandatoAbertoAPI = require('./mandatoaberto_api.js');
const VotoLegalAPI = require('./votolegal_api.js');
const Articles = require('./utils/articles.js');
const opt = require('./utils/options');
const dictionary = require('./utils/dictionary');
const audio = require('./utils/audio');
const attach = require('./attach');
const { createIssue } = require('./send_issue');

const apiai = dialogFlow(process.env.DIALOGFLOW_TOKEN);

const phoneRegex = new RegExp(/^(?:(?:\+|00)?(55)\s?)?(?:\(?([1-9][0-9])\)?\s?)?(?:((?:9\d|[2-9])\d{3})-?(\d{4}))$/);
// const phoneRegex = new RegExp(/^\+55\d{2}(\d{1})?\d{8}$/);

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

const IssueTimerlimit = eval(process.env.ISSUE_TIMER_LIMIT); // 20 seconds -> listening to user doubts -> 1000 * 20 // eslint-disable-line
const MenuTimerlimit = eval(process.env.MENU_TIMER_LIMIT); // 60 seconds -> waiting to show the initial menu -> 1000 * 60
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

function capitalize(s) {
	return s && s[0].toUpperCase() + s.slice(1);
}

async function loadOptionPrompt(context) {
	if (!context.state.optionPrompt || context.state.optionPrompt === '') {
		const answer = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'option_prompt');
		if (!answer || (answer && !answer.content) || (answer && answer.content === '')) {
			return 'Que tal escolher uma das opções abaixo? Ou digite sua pergunta e nos mande!';
		}
		return answer.content;
	}
	return context.state.optionPrompt.content;
}

// async function sendMainMenu(context) {
// 	await attach.sendButtons(context.session.user.id, await loadOptionPrompt(context),
// 		[opt.aboutPolitician, opt.availableIntents], [opt.participate, opt.poll_suaOpiniao], context.state.politicianData.fb_access_token);
// 	// await context.sendButtonTemplate(await loadOptionPrompt(context), await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
// }

async function loadIssueStarted(context) {
	const answer = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_started_listening');
	if (!answer || (answer && !answer.content) || (answer && answer.content === '')) {
		return 'Que legal! Digite o que quer dizer abaixo!';
	}
	return answer.content;
}

async function loadIssueSent(context) {
	const answer = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'issue_created');
	if (!answer || (answer && !answer.content) || (answer && answer.content === '')) {
		return 'Recebemos sua mensagem. Irei encaminhar para nosso equipe, que irá te responder.';
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


// async function listThemes(obj) {
// 	let themes = [];
// 	await Object.keys(obj).forEach(async (element) => {
// 		if (dictionary[obj[element]]) { // checks if there is a dictionary entry for element
// 			themes.push(dictionary[obj[element]].toLowerCase());
// 		} else {
// 			themes.push(obj[element].toLowerCase().replace('_', ' ')); // remove upper case and underscore just to be safe
// 		}
// 	});
// 	themes = themes.sort().join(', ').replace(/,(?=[^,]*$)/, ' e');
// 	return themes.length > 0 ? themes : 'esses assuntos';
// }

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

async function checkMenu(context, dialogs) { // eslint-disable-line
	if (process.env.BIORAMA === 'true') { // check if we are on a different brach
		const results = [];
		results.push(opt.availableIntents);
		results.push(opt.participate);
		results.push(opt.talkToUs);
		return results;
	}
	if (!context.state.introduction) { // just in case something goes way off
		await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
		await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
	}
	if (context.state.introduction && !context.state.introduction.content) { dialogs = dialogs.filter(obj => obj.payload !== 'aboutMe'); }
	if (!context.state.trajectory) { dialogs = dialogs.filter(obj => obj.payload !== 'trajectory'); }
	if (!context.state.pollData) { dialogs = dialogs.filter(obj => obj.payload !== 'poll'); }
	if (!context.state.politicianData.contact || (context.state.politicianData.contact.email === null && context.state.politicianData.contact.twitter === null
		&& context.state.politicianData.contact.facebook === null && (context.state.politicianData.contact.url === 'http://' || context.state.politicianData.contact.url === null)
		&& context.state.politicianData.contact.cellphone === '+55')) {
		dialogs = dialogs.filter(obj => obj.payload !== 'contacts');
	}

	if (dialogs.find(x => x.payload === 'poll')) {
		if (await checkPollAnswered(context) === true // already answered so we remove option
			|| (Object.keys(context.state.pollData).length === 0 && context.state.pollData.constructor === Object)) { // no active poll
			dialogs = await dialogs.filter(obj => obj.payload !== 'poll');
			await dialogs.push(opt.talkToUs);
		}
	}

	if (dialogs.find(x => x.payload === 'availableIntents')) { // filtering out "temas" for everybody
		dialogs = await dialogs.filter(obj => obj.payload !== 'availableIntents');
	}

	return dialogs;
}

async function sendMenu(context, text, options) {
	const buttons = await checkMenu(context, options);
	if (!buttons || buttons.length === 0) {
		await context.sendText(text);
	} else if (buttons.length <= 3) {
		await context.sendButtonTemplate(text, buttons);
	} else if (buttons.length === 4) {
		await attach.sendButtons(context.session.user.id, text,
			[buttons[0], buttons[1]], [buttons[2], buttons[3]], context.state.politicianData.fb_access_token);
	}
}

async function showThemesQR(context) {
	await context.setState({ firstTime: true }); // flag to check during answer loop that we have to load the types we have
	await context.setState({ availableIntents: await MandatoAbertoAPI.getAvailableIntents(context.event.rawEvent.recipient.id, context.state.paginationNumber) });
	await context.setState({ nextIntents: await MandatoAbertoAPI.getAvailableIntents(context.event.rawEvent.recipient.id, context.state.paginationNumber + 1) });
	// console.log('currentPage', context.state.paginationNumber);
	// console.log('current intents', context.state.availableIntents);
	// console.log('nextIntents', context.state.nextIntents);

	console.log('context.state.availableIntents.intents', context.state.availableIntents.intents);


	await context.sendText('Escolha um tema:', await attach.getIntentQR(context.state.availableIntents.intents, context.state.nextIntents.intents));
}

function getDictionary(word) {
	const result = dictionary[word.toLowerCase()];
	if (result) {
		return result.toLowerCase();
	}
	return word.toLowerCase();
}

// removes every empty intent object and returns the object
async function removeEmptyKeys(obj) {
	Object.keys(obj).forEach((key) => {
		if (obj[key].length === 0) {
			delete obj[key];
		}
		if (obj === 'Falso') {
			delete obj[key];
		}
	});
	return obj;
}

// getting the types we have on our KnowledgeBase
async function getOurTypes(KnowledgeBase) {
	const result = [];
	KnowledgeBase.forEach(async (element) => {
		result.push(element.type);
	});

	return result;
}
/*
	checkTypes: Getting the types we will show to the user.	TypesToCheck are the possible types we can have.
	The point of checking which type was in the question and we have it out base is to confirm using the correct type.
	We expect entities to be a string, so we add it at the beginning of the results array, after that we simply add the themes we have the answer for.
	If we couldn't detect any types on the question we default to 'posicionamento'.
*/
async function checkTypes(entities, knowdlege) {
	console.log('tipos de pergunta:', entities);

	const typesToCheck = ['posicionamento', 'proposta', 'histórico'];
	const result = [];
	// if (entities.constructor === Array) { // case entities is an array
	// // check if we have the type the user wants to know and add it to result
	// 	typesToCheck.forEach(((element) => {
	// 		if (entities.includes(element) && knowdlege.includes(element)) {
	// 			result.push(element);
	// 		}
	// 	}));
	// }

	if (entities && entities !== '') { // string exists and isn't empty, this is the type the user asked
		if (typesToCheck.includes(entities.toLowerCase() && knowdlege.includes(entities.toLowerCase()))) {
			result.push(entities.toLowerCase());
		}
	}
	// check if we have a correlated answer that the user didn't ask for
	typesToCheck.forEach(((element) => {
		if (knowdlege.includes(element) && !result.includes(element)) {
			result.push(element);
		}
	}));

	return result;
}

// preparets the text to be shown
async function getTypeText(type) { // eslint-disable-line no-unused-vars
	if (type === 'proposta') {
		return 'minha proposta';
	} if (type === 'histórico') {
		return 'meu histórico';
	}
	return 'meu posicionamento';
}

async function checkPosition(context) {
	await context.setState({ dialog: 'prompt' });

	switch (context.state.intentName) {
	case 'Saudação':
		await context.setState({ dialog: 'greetings' });
		break;
	case 'Trajetoria':
		await context.setState({ dialog: 'trajectory' });
		break;
	case 'Voluntário':
		await context.setState({ dialog: 'participateMenu' });
		break;
	case 'FaleConosco':
		await context.setState({ whatWasTyped: '' });
		delete userMessages[context.session.user.id]; // deleting last sent message (it was sent already)
		await context.setState({ dialog: 'createIssue' });
		break;
	case 'Fallback': // didn't understand what was typed
		if (await createIssue(context)) { await context.sendText(getRandom(opt.frases_fallback)); }
		await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
		break;
	default: // default acts for every intent - position
		await context.setState({ // getting knowledge base. We send the complete answer from dialogflow
			knowledge: await MandatoAbertoAPI.getknowledgeBase(context.state.politicianData.user_id, context.state.apiaiResp),
		});
		console.log('knowledge', context.state.knowledge);

		// check if there's at least one answer in knowledge_base
		if (context.state.knowledge && context.state.knowledge.knowledge_base && context.state.knowledge.knowledge_base.length >= 1) {
			await context.setState({ entities: await removeEmptyKeys(context.state.resultParameters) }); // saving the entities that were detect by dialogflow
			console.log('entities', context.state.entities);
			await context.setState({ typesWeHave: await getOurTypes(context.state.knowledge.knowledge_base) }); // storing the types we have on our knowledge_base
			console.log('typesWeHave', context.state.typesWeHave);
			await context.setState({ types: await checkTypes(context.state.entities.Tipos_de_pergunta, context.state.typesWeHave) }); // getting common types
			console.log('types', context.state.types);
			await context.setState({ firstTime: true });
			await context.sendButtonTemplate('Você está perguntando sobre '// confirm themes with user
					+ `${getDictionary(context.state.intentName)}?`, opt.themeConfirmation); // obs: the payload of the Yes/Sim option defaults to 'themeYes0'
		} else { // no answers in knowledge_base (We know the entity but politician doesn't have a position)
			if (await createIssue(context)) {
				await context.sendText(`🤔 Eu ainda não perguntei para ${await getArtigoCargoNome(context)} sobre `
					+ 'esse assunto. Irei encaminhar para nossa equipe, está bem?');
			}
			await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
		}
		break;
	}
}

const handler = new MessengerHandler()
	.onEvent(async (context) => { // eslint-disable-line
		if (!context.event.isDelivery && !context.event.isEcho && !context.event.isRead && context.event.rawEvent.field !== 'feed') {
			await context.typingOn();

			// console.log(await MandatoAbertoAPI.getLogAction()); // print possible log actions
			// we reload politicianData on every useful event
			// we update context data at every interaction that's not a comment or a post
			await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
			await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });

			await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
				fb_id: context.session.user.id,
				name: `${context.session.user.first_name} ${context.session.user.last_name}`,
				gender: context.session.user.gender === 'male' ? 'M' : 'F',
				origin_dialog: 'greetings',
				picture: context.session.user.profile_pic,
				// session: JSON.stringify(context.state),
			});

			console.log(`.session/messenger:${context.event.sender.id}.json`);
			console.log(await fse.pathExists(`.session/messenger:${context.event.sender.id}.json`));

			// if (!context.state.dialog) { // because of the message that comes from the comment private-reply
			if (await fse.pathExists(`.session/messenger:${context.event.sender.id}.json`) === false) { // because of the message that comes from the comment private-reply
				await context.setState({ dialog: 'greetings' });
			} else if (context.state.dialog !== 'recipientData' && context.state.dialog !== 'pollAnswer') { // handling input that's not from "asking data" or answering poll (obs: 'pollAnswer' from timer will bypass this)
				if (context.event.isPostback) {
					// we are not listening anymore if user clicks on persistent menu during the listening
					if (listening[context.session.user.id]) { delete listening[context.session.user.id]; }
					// Question/Position flow
					if (context.event.postback.payload.slice(0, 8) === 'themeYes') { // user confirms that theme(s) is/are correct
						await context.setState({ number: context.event.postback.payload.replace('themeYes', '') }); context.event.postback.payload.replace('themeYes', '');
						// find the correspondent answer using the current type
						await context.setState({ currentTheme: await context.state.knowledge.knowledge_base.find(x => x.type === context.state.types[context.state.number]) });
						// console.log('currentTheme', currentTheme);
						if (context.state.firstTime === true) { // we log only on the first answer
							await MandatoAbertoAPI.logAskedEntity(context.session.user.id, context.state.politicianData.user_id, context.state.currentTheme.entities[0].id);
							await context.setState({ firstTime: false });
						}
						if (context.state.currentTheme && (context.state.currentTheme.answer
							|| (context.state.currentTheme.saved_attachment_type !== null && context.state.currentTheme.saved_attachment_id !== null))) {
							if (context.state.currentTheme.answer) { // if there's a text asnwer we send it
								await context.sendText(`${capitalize(context.state.types[context.state.number])}: ${context.state.currentTheme.answer}`);
							}
							if (context.state.currentTheme.saved_attachment_type === 'image') { // if attachment is image
								await context.sendImage({ attachment_id: context.state.currentTheme.saved_attachment_id });
							}
							if (context.state.currentTheme.saved_attachment_type === 'video') { // if attachment is video
								await context.sendVideo({ attachment_id: context.state.currentTheme.saved_attachment_id });
							}
							if (context.state.currentTheme.saved_attachment_type === 'audio') { // if attachment is audio
								await context.sendAudio({ attachment_id: context.state.currentTheme.saved_attachment_id });
							}
							await context.typingOn();
							// building the menu
							context.state.types.splice(context.state.number, 1); // removing the theme we just answered
							if (context.state.types.length === 0) { // we don't have anymore type of answer (the user already clicked throught them all)
								setTimeout(async () => {
									await sendMenu(context, await loadOptionPrompt(context),
										[opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
									// await context.sendButtonTemplate(await loadOptionPrompt(context),
									// 	await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
								}, 5000);
							} else {
								await context.setState({ options: [] }); // building the options menu
								// for each type we still haven't answered we add an option with each index on the payload
								context.state.types.forEach((element, index) => {
									context.state.options.push({ type: 'postback', title: `${capitalize(element)}`, payload: `themeYes${index}` });
								});
								context.state.options.push({ type: 'postback', title: 'Voltar', payload: 'mainMenu' });
								// console.log('options', context.state.options);
								setTimeout(async () => {
									await context.sendButtonTemplate(`Deseja saber mais sobre ${getDictionary(context.state.intentName)}?`, context.state.options);
								}, 5000);
							}
						} else { // we couldn't find neither text answer nor attachment (This is an error and it shouldn't happen)
							if (await createIssue(context)) {
								await context.sendText('Parece que fico te devendo essa resposta. '
									+ 'Mas já entou enviando para nossas equipe e estaremos te respondendo em breve.');
							}
							// await context.sendButtonTemplate(await loadOptionPrompt(context),
							// 	await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
							await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
						}
						// end answering theme --------------------------------------------------
					} else if (context.event.postback.payload.slice(0, 6) === 'answer') {
						await context.setState({ question: context.state.knowledge.knowledge_base.find(x => x.id === parseInt(context.event.postback.payload.replace('answer', ''), 10)) });
						await context.setState({ dialog: 'showAnswer' });
					} else if (context.event.postback.payload === 'talkToUs') { // user wants to enter in contact
						await MandatoAbertoAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id,
							context.event.postback.payload, context.event.postback.title);
						delete userMessages[context.session.user.id]; // deleting last sent message (it was sent already) title
						await context.setState({ dialog: 'createIssue' });
					} else if (context.event.postback.payload === 'availableIntents') {
						await context.setState({ paginationNumber: 1, availableIntents: '', nextIntents: '' }); // resetting data
						await MandatoAbertoAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id,
							context.event.postback.payload, context.event.postback.title);
						await showThemesQR(context);
						await context.setState({ dialog: context.event.postback.payload });
					} else {
						if (context.event.postback.payload === 'recipientData') { context.event.postback.title = 'Deixar Contato'; } // confirmation after pollAnswer
						await MandatoAbertoAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id,
							context.event.postback.payload, context.event.postback.title);
						await context.setState({ dialog: context.event.postback.payload });
					}
				} else if (context.event.isQuickReply) {
					const { payload } = context.event.message.quick_reply;
					if (payload.slice(0, 4) === 'poll') { // user answered poll that came from timer
						await context.setState({ dialog: 'pollAnswer' });
					} else if (payload.slice(0, 12) === 'answerIntent') {
						await context.setState({ themeName: payload.replace('answerIntent', '') }); // getting the theme name
						await context.setState({ number: payload[payload.length - 1] });// getting the number type
						await context.setState({ themeName: context.state.themeName.replace(context.state.number, '') }); // getting the theme name
						await context.setState({ // getting knowledge base. We send the complete answer from dialogflow
							knowledge: await MandatoAbertoAPI.getknowledgeBaseByName(context.state.politicianData.user_id, context.state.themeName),
						});
						if (context.state.firstTime === true) {
							await context.setState({ types: await getOurTypes(context.state.knowledge.knowledge_base) });
							await context.setState({ firstTime: false });
						}

						console.log('knowledge', context.state.knowledge);
						console.log('themeName', context.state.themeName);
						console.log('number', context.state.number);
						console.log('type', context.state.types);
						console.log('context.state.types[context.state.number]', context.state.types[context.state.number]);

						await context.setState({ currentTheme: context.state.knowledge.knowledge_base.find(x => x.type === context.state.types[context.state.number]) });
						console.log('currentTheme', context.state.currentTheme);

						if (context.state.currentTheme && (context.state.currentTheme.answer
							|| (context.state.currentTheme.saved_attachment_type !== null && context.state.currentTheme.saved_attachment_id !== null))) {
							if (context.state.currentTheme.answer) { // if there's a text asnwer we send it
								await context.sendText(`${capitalize(context.state.types[context.state.number])}: ${context.state.currentTheme.answer}`);
							}
							if (context.state.currentTheme.saved_attachment_type === 'image') { // if attachment is image
								await context.sendImage({ attachment_id: context.state.currentTheme.saved_attachment_id });
							}
							if (context.state.currentTheme.saved_attachment_type === 'video') { // if attachment is video
								await context.sendVideo({ attachment_id: context.state.currentTheme.saved_attachment_id });
							}
							if (context.state.currentTheme.saved_attachment_type === 'audio') { // if attachment is audio
								await context.sendAudio({ attachment_id: context.state.currentTheme.saved_attachment_id });
							}
							await context.typingOn();
						} // end currentTheme if --------------------------------------------------

						context.state.types.splice(context.state.number, 1); // removing the theme we just answered
						console.log(context.state.types);
						if (context.state.types.length === 0) { // we don't have anymore type of answer (the user already clicked throught them all)
							setTimeout(async () => {
								await context.sendText('Quer ver mais temas? Ou prefere voltar para o menu?', { quick_replies: opt.themeEnd });
								// await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
							}, 5000);
						} else {
							await context.setState({ options: [] }); // building the options menu
							// for each type we still haven't answered we add an option with each index on the payload
							context.state.types.forEach((element, index) => {
								context.state.options.push({
									content_type: 'text',
									title: `${capitalize(element)}`,
									payload: `answerIntent${attach.capitalizeFirstLetter(context.state.themeName)}${index}`,
								});
							});
							context.state.options.push({ content_type: 'text', title: 'Temas', payload: 'availableIntents' });
							context.state.options.push({ content_type: 'text', title: 'Voltar', payload: 'themeEnd' });
							console.log('options', context.state.options);
							setTimeout(async () => {
								await context.sendText(`Deseja saber mais sobre ${getDictionary(context.state.themeName)}?`, { quick_replies: context.state.options });
							}, 2000);
						}
					} else if (payload === 'moreThemes') {
						await context.setState({ paginationNumber: context.state.paginationNumber + 1 });
						await showThemesQR(context);
					} else if (payload === 'availableIntents') {
						await context.setState({ paginationNumber: 1, availableIntents: '', nextIntents: '' }); // resetting data
						console.log('context.event.message.quick_reply', context.event.message.quick_reply);
						await MandatoAbertoAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id,
							context.event.message.quick_reply.payload, opt.availableIntents.title);
						await showThemesQR(context);
						await context.setState({ dialog: payload });
					} else {
						if (payload === 'mainMenu') {
							await MandatoAbertoAPI.logFlowChange(context.session.user.id, context.state.politicianData.user_id,
								context.event.message.quick_reply.payload, opt.themeEnd[1].title);
						}
						await context.setState({ dialog: payload });
					}
				} else if (context.event.isAudio) {
					if (context.state.politicianData.use_dialogflow === 1) { // check if politician is using dialogFlow
						await context.sendText('Áudio? Me dê um instante para processar.');
						if (context.event.audio.url) {
							await context.setState({ audio: await audio.voiceRequest(context.event.audio.url, context.session.user.id) });
							if (context.state.audio.txtMag && context.state.audio.txtMag !== '') { // there was an error (or the user just didn't say anything)
								await sendMenu(context, context.state.audio.txtMag, [opt.trajectory, opt.contacts, opt.participate, opt.availableIntents]);
							} else {
								await context.setState({ whatWasTyped: context.state.audio.whatWasSaid });
								await context.setState({ resultParameters: context.state.audio.parameters });
								await context.setState({ intentName: context.state.audio.intentName });
								await checkPosition(context);
							}
						}
					} else {
						delete userMessages[context.session.user.id]; // deleting last sent message (it was sent already)
						await context.setState({ dialog: 'createIssue' });
					}
				} else if (context.event.isText) {
					await context.setState({ whatWasTyped: context.event.message.text }); // has to be set here because of talkToUs
					if (!listening[context.session.user.id] || listening[context.session.user.id] === false) { // if we are listening we don't try to interpret the text
						// if (context.state.whatWasTyped.toLowerCase() === 'sim') { // temporary measure for fixing messages that come from comment_response message
						// 	await context.setState({ dialog: 'greetings' });
						// } else
						if (context.state.politicianData.use_dialogflow === 1) { // check if politician is using dialogFlow
							await context.setState({ apiaiResp: await apiai.textRequest(context.state.whatWasTyped, { sessionId: context.session.user.id }) });
							await context.setState({ resultParameters: context.state.apiaiResp.result.parameters }); // getting the entities
							await context.setState({ intentName: context.state.apiaiResp.result.metadata.intentName }); // getting the intent
							await checkPosition(context);
						} else { // not using dialogFlow
							await context.setState({ noDialogFlow: context.event.message.text });
							delete userMessages[context.session.user.id]; // deleting last sent message (it was sent already)
							await context.setState({ dialog: 'createIssue' });
						}
					}
				} // end if isText
			}
		}

		if (context.session) {
			// if the user interacts while this timer is running we don't need to show the menu anymore
			if (menuTimers[context.session.user.id]) { clearTimeout(menuTimers[context.session.user.id]); delete menuTimers[context.session.user.id]; }

			// if the user interacts while this timer is running we don't need to run confirm that the issue was sent anymore
			if (postIssueTimers[context.session.user.id]) { clearTimeout(postIssueTimers[context.session.user.id]); delete postIssueTimers[context.session.user.id]; }
		}
		if (context.event.rawEvent.postback) {
			if (context.event.rawEvent.postback.referral) { // if this exists we are on external site
				await context.setState({ facebookPlataform: 'CUSTOMER_CHAT_PLUGIN' });
			} else { // if it doesn't exists we are on an facebook/messenger
				await context.setState({ facebookPlataform: 'MESSENGER' });
			}
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

			// Tratando botão GET_STARTED
			if (context.event.postback && context.event.postback.payload === 'greetings') {
				// await context.resetState();

				await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
				await context.setState({ dialog: 'greetings' });
				// pollTimers[context.session.user.id] = setTimeout(async () => { // create pollTimer for user
				// 	// checks if user already answered poll (if he did, there's no reason to send it. In this case should be !== true)
				// if (await checkPollAnswered(context) === true // already answered so we remove option
				// || (Object.keys(context.state.pollData).length === 0 && context.state.pollData.constructor === Object)) { // no active poll
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
			if (context.event.isQuickReply && (context.state.dialog !== 'pollAnswer') && !(context.event.message.quick_reply.payload.includes('pollAnswerPropagate'))
				&& (context.state.dialog !== 'recipientData')) {
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
				await MandatoAbertoAPI.logAnsweredPoll(context.session.user.id, context.state.politicianData.user_id, context.state.answer);
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
						await context.setState({ cellphone: `+55${context.state.cellphone.replace(/[- .)(]/g, '')}` });
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
			case 'greetings': // primeiro
				await context.typingOff();
				areWeListening = true;
				await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
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
					await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
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
				await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
				// await context.sendButtonTemplate(await loadOptionPrompt(context), await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'NotOneOfThese': // user said "no" on theme confirmation
				if (menuTimers[context.session.user.id]) { delete menuTimers[context.session.user.id]; } // for safety reasons
				// maybe we don't need to verify if this should be an issue because dialogflow already indentified something
				await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id, context.session.user.id,
					context.state.whatWasTyped, context.state.apiaiResp);
				await context.sendText('Que pena! Parece que eu errei. Mas recebi sua dúvida e estaremos te respondendo logo mais! Quer fazer outra pergunta?');
				menuTimers[context.session.user.id] = setTimeout(async () => { // wait 'MenuTimerlimit' to show options menu
					await sendMenu(context, await loadOptionPrompt(context), [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
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
			case 'participateMenu': // Participar
				await context.setState({ participateText: 'Estamos em campanha e contamos com você.\n' }); // getting the first part of the text

				if (context.state.politicianData.votolegal_integration && context.state.politicianData.votolegal_integration.votolegal_url) {
					await context.setState({ participateTimer: 2500 }); // setting the wait time for the next message
					// check if politician is on votoLegal so we can info and option
					// if referral.source(CUSTOMER_CHAT_PLUGIN) exists we are outside facebook and shouldn't send votolegal's url
					if ((context.event.rawEvent.postback && context.event.rawEvent.postback.referral) || (context.event.rawEvent.message && context.event.rawEvent.message.tags
							&& context.event.rawEvent.message.tags.source && context.event.rawEvent.message.tags.source === 'customer_chat_plugin')) {
						await context.sendText(`${context.state.participateText}Você já está na nossa página para doar.`);
						await context.sendText('Seu apoio é fundamental para nossa campanha!');
					} else {
						await context.setState({ valueLegal: await VotoLegalAPI.getVotoLegalValues(context.state.politicianData.votolegal_integration.votolegal_username) });
						await context.setState({
							participateText: `${context.state.participateText}Já consegui R$${formatReal(context.state.valueLegal.candidate.total_donated)} da minha meta de `
									+ `R$${formatReal(getMoney(context.state.valueLegal.candidate.raising_goal))}.`,
						});
						await context.sendButtonTemplate(`${context.state.participateText} Apoie nossa campanha de arrecadação.`, [{
							type: 'web_url',
							url: `${context.state.politicianData.votolegal_integration.votolegal_url}`,
							title: 'Quero doar!',
						}]);
					}
				} else { // if politician doesn't have votoLegal
					await context.sendText(context.state.participateText);
				}
				await context.typingOn();
				// check if there is a share obj so we can show the option
				if (context.state.politicianData.share && context.state.politicianData.share.url && context.state.politicianData.share.text) {
					// if it exists, we showed the first option, so we have to wait before sending this one. If not, this will be the first msg, we can show it right away.
					await context.setState({ participateTimer: context.state.participateTimer ? context.state.participateTimer : 1 });
					setTimeout(async () => { // adding a timer to wait a little bit between each message
						await context.sendButtonTemplate(context.state.politicianData.share.text, [{
							type: 'web_url',
							url: context.state.politicianData.share.url,
							title: 'Divulgar',
						}]);
					}, context.state.participateTimer);
				}
				// !timer -> only message (no waiting), timer === 1 -> second message (has to wait a little), timer === 2500 -> third message (waits for both messages)
				if (!context.state.participateTimer) { await context.setState({ participateTimer: 0 }); }

				setTimeout(async () => { // adding a timer to wait a little bit between each message
					await context.sendButtonTemplate('Deixe seus contatos para nossa equipe.', [opt.leaveInfo, opt.backToBeginning]);
					await context.typingOff();
				}, context.state.participateTimer === 1 ? 2500 : context.state.participateTimer * 2);

				await context.setState({
					dialog: 'prompt', dataPrompt: 'email', recipientData: '', participateTimer: '',
				});
				break;
			case 'createIssue': // aka "talkToUs" // will only happen if user clicks on 'Fale Conosco'
				await context.setState({ issueCreatedMessage: await loadIssueSent(context) }); // loading the confirmation message here

				if (await listening[context.session.user.id] === true) { // if we are 'listening' we need to aggregate every message the user sends
					userMessages[context.session.user.id] = `${userMessages[context.session.user.id]}${context.state.whatWasTyped} `;
				} else { // we are not 'listening' -> it's the first time the user gets here
					await context.setState({ issueStartedListening: await loadIssueStarted(context) });
					await context.sendText(context.state.issueStartedListening);
					listening[context.session.user.id] = true;
					await context.typingOn();
					userMessages[context.session.user.id] = ''; // starting the userMessage
					if (context.state.noDialogFlow && context.state.noDialogFlow.length > 0) {
						userMessages[context.session.user.id] = `${context.state.noDialogFlow} `;
					}
				}

				if (issueTimers[context.session.user.id]) { // check if timer already exists, and delete it if it does
					clearTimeout(issueTimers[context.session.user.id]);
					await context.typingOn(); // show user that we are listening
				}

				if (postIssueTimers[context.session.user.id]) { // check if timer already exists, and delete it if it does
					clearTimeout(postIssueTimers[context.session.user.id]);
				}

				// create new (or reset) timer for sending message
				issueTimers[context.session.user.id] = setTimeout(async () => {
					if (userMessages[context.session.user.id] !== '') { // check if there's a message to send
						await MandatoAbertoAPI.postIssueWithoutEntities(context.state.politicianData.user_id, context.session.user.id, userMessages[context.session.user.id]);
						// console.log('Enviei ', userMessages[context.session.user.id]);
						await context.typingOff();
					}
					delete issueTimers[context.session.user.id]; // deleting this timer from timers object
					delete listening[context.session.user.id];
				}, IssueTimerlimit);

				// create new (or reset) timer for confirmation timer (will only be shown if user doesn't change dialog
				postIssueTimers[context.session.user.id] = setTimeout(async () => {
					if (!userMessages[context.session.user.id] || userMessages[context.session.user.id] === '') {
						await context.sendButtonTemplate('Não tem nenhuma mensagem para nossa equipe? Se tiver, clique em "Fale Conosco" e escreva sua mensagem.',
							await checkMenu(context, [opt.contacts, opt.participate, opt.talkToUs]));
					} else {
						await context.sendButtonTemplate(context.state.issueCreatedMessage,
							await checkMenu(context, [opt.keepWriting, opt.backToBeginning]));
					}
				}, IssueTimerlimit + 2);
				break;
			case 'aboutMe': {
				const introductionText = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, 'introduction');
				await context.sendText(introductionText.content);
				await sendMenu(context, `O que mais deseja saber sobre ${context.state.articles.defined} ${context.state.politicianData.office.name}?`,
					[opt.trajectory, opt.contacts, opt.participate, opt.availableIntents]);
				// await context.sendButtonTemplate(`O que mais deseja saber sobre ${context.state.articles.defined} ${context.state.politicianData.office.name}?`,
				// 	await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));
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
				if (context.state.politicianData.contact.cellphone && context.state.politicianData.contact.cellphone !== '+55') {
					await context.sendText(` - Através do WhatsApp: ${context.state.politicianCellPhone}`);
				}
				if (context.state.politicianData.contact.twitter) {
					await context.sendText(` - Através do Twitter: ${context.state.politicianData.contact.twitter}`);
				}
				if (context.state.politicianData.contact.url && context.state.politicianData.contact.url !== 'http://') {
					await context.sendText(` - Através do site: ${context.state.politicianData.contact.url}`);
				}
				await sendMenu(context, 'Quer saber mais?', [opt.trajectory, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
				// await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.trajectory, opt.poll_suaOpiniao, opt.participate]));
				await context.setState({ dialog: 'prompt', politicianCellPhone: undefined });
				break;
			case 'poll': {
				if (await checkPollAnswered(context) === true) {
					await context.sendText('Ah, que pena! Você já respondeu essa pergunta.');
					await sendMenu(context, 'Se quiser, eu posso te ajudar com outra coisa.', [opt.trajectory, opt.contacts, opt.participate, opt.availableIntents]);
					// await context.sendButtonTemplate('Se quiser, eu posso te ajudar com outra coisa.',
					// 	await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));
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
					await sendMenu(context, 'Se quiser, eu posso te ajudar com outra coisa.', [opt.trajectory, opt.contacts, opt.participate, opt.availableIntents]);
					// await context.sendButtonTemplate('Se quiser, eu posso te ajudar com outra coisa.',
					// await checkMenu(context, [opt.trajectory, opt.contacts, opt.participate]));
				}
				break;
			}
			case 'pollAnswer':
				if (context.state.sentPersonalData !== true) { // !== true
					await context.sendButtonTemplate('Muito obrigado por sua resposta. Você gostaria de deixar seu e-mail e telefone para nossa equipe?', opt.recipientData_LetsGo);
					await context.setState({ dialog: 'prompt', dataPrompt: 'email', recipientData: '' });
				} else { // if it's true, user already sent his personal data
					await sendMenu(context, 'Muito obrigado por sua resposta. Quer saber mais?', [opt.aboutPolitician, opt.talkToUs, opt.participate, opt.availableIntents]);
					await context.setState({ dialog: 'prompt' });
					// await context.sendButtonTemplate('Muito obrigado por sua resposta. Quer saber mais?',
					// await checkMenu(context, [opt.aboutPolitician, opt.talkToUs, opt.participate]));
				}
				break;
			case 'recipientData':
				if (context.event.postback && (context.event.postback.title === 'Agora não' || context.event.postback.title === 'Não')) {
					await sendMenu(context, 'Está bem! Posso te ajudar com mais alguma informação?',
						[opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
					// await context.sendButtonTemplate('Está bem! Posso te ajudar com mais alguma informação?',
					// await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
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
							// await context.sendText('Qual é o seu telefone? Não deixe de incluir o DDD.');
							await context.sendText('Qual é o seu telefone? Não deixe de incluir o DDD.', { quick_replies: [{ content_type: 'user_phone_number' }] });
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
							await sendMenu(context, 'Quer saber mais?', [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
							// await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate]));
						} catch (err) {
							await sendMenu(context, 'Como posso te ajudar?', [opt.aboutPolitician, opt.trajectory, opt.participate, opt.availableIntents]);
							// await context.sendButtonTemplate('Como posso te ajudar?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.participate]));
						}
						await context.setState({ dialog: 'prompt', recipientData: '', dataPrompt: '' });
						break;
					}
				}
				break;
			case 'trajectory':
				await context.sendText(context.state.trajectory.content);
				await sendMenu(context, 'Quer saber mais?', [opt.poll_suaOpiniao, opt.contacts, opt.participate, opt.availableIntents]);
				// await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.poll_suaOpiniao, opt.contacts, opt.participate]));
				await context.setState({ dialog: 'prompt' });
				break;
			case 'themeEnd':
				await context.sendText('Quer ver mais temas? Ou prefere voltar para o menu?', { quick_replies: opt.themeEnd });
				break;
			case 'add_blacklist': // adding user to the blacklist from the persistent menu 0 -> turn off notification
				await MandatoAbertoAPI.updateBlacklist(context.session.user.id, 0);
				await MandatoAbertoAPI.logNotification(context.session.user.id, context.state.politicianData.user_id, 4);
				await context.sendText('Tudo bem. Não te enviaremos mais nenhuma notificação.');
				await sendMenu(context, 'Quer saber mais?', [opt.aboutPolitician, opt.trajectory, opt.participate, opt.availableIntents]);
				// await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.participate]));
				break;
			case 'remove_blacklist': // removing user to the blacklist from the persistent menu 1 -> turn on notification
				await MandatoAbertoAPI.updateBlacklist(context.session.user.id, 1);
				await MandatoAbertoAPI.logNotification(context.session.user.id, context.state.politicianData.user_id, 3);
				await context.sendText('Legal. Estaremos te avisando das novidades.');
				await sendMenu(context, 'Quer saber mais?', [opt.aboutPolitician, opt.trajectory, opt.participate, opt.availableIntents]);
				// await context.sendButtonTemplate('Quer saber mais?', await checkMenu(context, [opt.aboutPolitician, opt.trajectory, opt.participate]));
				break;
			} // end switch de diálogo
		}
	})
	.onError(async (context, err) => {
		const date = new Date();
		console.log('\n');
		console.log(`Parece que aconteceu um erro as ${date.toLocaleTimeString('pt-BR')} de ${date.getDate()}/${date.getMonth() + 1} =>`);
		console.log(err);
		// if (context.event.rawEvent.field === 'feed') {
		// 	if (context.event.rawEvent.value.item === 'comment' || context.event.rawEvent.value.item === 'post') {
		// 		// we update user data at every interaction that's not a comment or a post
		// 		await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
		// 		await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
		// 	}
		// } else {
		console.log(await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) }));
		console.log(await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) }));
		// }

		// console.log('\n\n\n\nrawEvent.recipient.id no catch', context.event.rawEvent.recipient.id);
		// console.log('politicianData no catch', context.state.politicianData);

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

		await sendMenu(context, 'Erro! Escreva uma mensagem para nós!', [opt.aboutPolitician, opt.poll_suaOpiniao, opt.participate, opt.availableIntents]);
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
