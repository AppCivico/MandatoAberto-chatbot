const request = require('requisition');
const queryString = require('query-string');

const security_token = process.env.SECURITY_TOKEN;
const apiUri = process.env.MANDATOABERTO_API_URL;

function removeEmptyKeys(obj) {
	Object.keys(obj).forEach((key) => { if (obj[key].length === 0) { delete obj[key]; } });
}

module.exports = {
	async getPoliticianData(pageId) {
		const res = await request(`${apiUri}/api/chatbot/politician?fb_page_id=${pageId}&security_token=${security_token}`);
		const politicianData = await res.json();
		return politicianData;
	},

	async getPollData(pageId) {
		const res = await request(`${apiUri}/api/chatbot/poll?fb_page_id=${pageId}&security_token=${security_token}`);
		const pollData = await res.json();
		return pollData;
	},

	async postRecipient(user_id, recipient) {
		const recipientData_qs = queryString.stringify(recipient);
		const res = await request.post(`${apiUri}/api/chatbot/recipient?${recipientData_qs}&security_token=${security_token}&`).query({ politician_id: user_id });
		const recipientData = await res.json();
		return recipientData;
	},

	async postPollAnswer(fb_id, poll_question_option_id, origin) {
		const res = await request.post(`${apiUri}/api/chatbot/poll-result?fb_id=${fb_id}&poll_question_option_id=${poll_question_option_id}&origin=${origin}&security_token=${security_token}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getPollAnswer(fb_id, poll_id) {
		const res = await request(`${apiUri}/api/chatbot/poll-result?fb_id=${fb_id}&poll_id=${poll_id}&security_token=${security_token}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getDialog(politician_id, dialog_name) {
		const res = await request(`${apiUri}/api/chatbot/dialog?politician_id=${politician_id}&dialog_name=${dialog_name}&security_token=${security_token}`);
		const dialog = await res.json();
		return dialog;
	},

	async getAnswer(politician_id, question_name) {
		const res = await request(`${apiUri}/api/chatbot/answer?politician_id=${politician_id}&question_name=${question_name}&security_token=${security_token}`);
		const question = await res.json();
		return question;
	},

	async postIssue(politician_id, fb_id, message, entities) {
		message = encodeURI(message);
		await removeEmptyKeys(entities);
		entities = JSON.stringify(entities);
		const res = await request.post(`${apiUri}/api/chatbot/issue?politician_id=${politician_id}&fb_id=${fb_id}&message=${message}&entities=${entities}&security_token=${security_token}`);
		const issue = await res.json();
		return issue;
	},

	async getknowledgeBase(politician_id, entities) {
		await removeEmptyKeys(entities);
		console.log(entities);
		entities = JSON.stringify(entities);
		const res = await request(`${apiUri}/api/chatbot/knowledge-base=${politician_id}&entities=${entities}&security_token=${security_token}`);
		const knowledgeBase = await res.json();
		console.log(knowledgeBase);
		return knowledgeBase;
	},

	async postPrivateReply(item, page_id, post_id, comment_id, permalink, user_id) {
		const res = await request.post(`${apiUri}/api/chatbot/private-reply?page_id=${page_id}&item=${item}&post_id=${post_id}&comment_id=${comment_id}&permalink=${permalink}&user_id=${user_id}&security_token=${security_token}`);
		const privateReply = await res.json();
		return privateReply;
	},
};
