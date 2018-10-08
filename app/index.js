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
const attach = require('./attach');

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
	if (!answer || (answer &