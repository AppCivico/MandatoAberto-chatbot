const request = require('requisition');
const queryString = require('query-string');

const apiUri = process.env.MANDATOABERTO_API_URL;

module.exports = {
	async getPoliticianData(pageId) {
		const res = await request(`${apiUri}/api/chatbot/politician?fb_page_id=${pageId}`);
		const politicianData = await res.json();
		return politicianData;
	},

	async getPollData(pageId) {
		const res = await request(`${apiUri}/api/chatbot/poll?fb_page_id=${pageId}`);
		const pollData = await res.json();
		return pollData;
	},

	async postRecipient(user_id, recipient) {
		const recipientData_qs = queryString.stringify(recipient);
		const res = await request.post(`${apiUri}/api/chatbot/recipient?${recipientData_qs}&`).query( {politician_id: user_id} );
		const recipientData = await res.json();
		return recipientData;
	},

	// async getRecipient(fb_id) {
	// 	const res = await request
	// }

	async postPollAnswer(fb_id, poll_question_option_id) {
		const res = await request.post(`${apiUri}/api/chatbot/poll-result?fb_id=${fb_id}&poll_question_option_id=${poll_question_option_id}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getPollAnswer(fb_id, poll_id) {
		const res = await request(`${apiUri}/api/chatbot/poll-result?fb_id=${fb_id}&poll_id=${poll_id}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getDialog(politician_id, dialog_name) {
		const res = await request(`${apiUri}/api/chatbot/dialog?politician_id=${politician_id}&dialog_name=${dialog_name}`);
		const dialog = await res.json();
		return dialog;
	},

	async getAnswer(politician_id, question_name) {
		const res = await request(`${apiUri}/api/chatbot/answer?politician_id=${politician_id}&question_name=${question_name}`);
		const question = await res.json();
		return question;
	},

	async postIssue(politician_id, fb_id, message) {
		message = encodeURI(message);
		const res = await request.post(`${apiUri}/api/chatbot/issue?politician_id=${politician_id}&fb_id=${fb_id}&message=${message}`);
		const issue = await res.json;
		return issue;
	}
};
