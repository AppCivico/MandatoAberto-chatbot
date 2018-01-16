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

	async postCitizen(userId, citizen) {
		const citizenDataQs = queryString.stringify(citizen);
		const res = await request.post(`${apiUri}/api/chatbot/citizen?${citizenDataQs}&`).query({ politician_id: userId });
		const citizenData = await res.json();
		return citizenData;
	},

	async postPollAnswer(fbId, optionId) {
		const res = await request.post(`${apiUri}/api/chatbot/poll-result?fb_id=${fbId}&option_id=${optionId}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getPollAnswer(fbId, pollId) {
		const res = await request(`${apiUri}/api/chatbot/poll-result?fb_id=${fbId}&poll_id=${pollId}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getDialog(politicianId, dialogName) {
		const res = await request(`${apiUri}/api/chatbot/dialog?politician_id=${politicianId}&dialog_name=${dialogName}`);
		const dialog = await res.json();
		return dialog;
	},

	async getAnswer(politicianId, questionName) {
		const res = await request(`${apiUri}/api/chatbot/answer?politician_id=${politicianId}&question_name=${questionName}`);
		const question = await res.json();
		return question;
	},
};
