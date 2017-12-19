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

	async postCitizen(user_id, citizen) {
		const citizenData_qs = queryString.stringify(citizen);
		const res = await request.post(`${apiUri}/api/chatbot/citizen?${citizenData_qs}&`).query( {politician_id: user_id} );
		const citizenData = await res.json();
		return citizenData;
	},

	async postPollAnswer(fb_id, option_id) {
		const res = await request.post(`${apiUri}/api/chatbot/poll-result?fb_id=${fb_id}&option_id=${option_id}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	},

	async getPollAnswer(fb_id, poll_id) {
		const res = await request(`${apiUri}/api/chatbot/poll-result?fb_id=${fb_id}&poll_id=${poll_id}`);
		const pollAnswer = await res.json();
		return pollAnswer;
	}
};
