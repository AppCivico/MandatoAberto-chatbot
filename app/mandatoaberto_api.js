const request = require('requisition');
const queryString = require('query-string');

const apiUri = process.env.MANDATOABERTO_API_URL;

// let apiKey;
// let userId;

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
		const res = await request.post(`${apiUri}/api/chatbot/citizen`).query( 
			{politician_id: user_id}, 
			citizenData_qs
		);
		console.log(res);
		const citizenData = await res.json();
		return citizenData;
	}

	// postCitizen(callback, citizen) {
	// 	// Primeiro realizo a autenticação
	// 	const options = {
	// 		url: `${apiUri}/api/login`,
	// 		headers,
	// 		method: 'POST',
	// 		form: {
	// 			email,
	// 			password,
	// 		},
	// 		json: true,
	// 	};

	// 	request(options)
	// 		.then((bodyThen) => {
	// 			apiKey = bodyThen.api_key;
	// 			userId = bodyThen.user_id;

	// 			// Depois puxo os dados do representante público
	// 			options.method = 'POST';
	// 			options.url = `${apiUri}/api/chatbot/citizen`;
	// 			options.form = { api_key: apiKey };

	// 			request(options)
	// 				.then((bodyRequest) => {
	// 					const poll = bodyRequest;

	// 					return callback(poll);
	// 				})
	// 				.catch((err) => {
	// 					console.log(err);
	// 				});
	// 		})
	// 		.catch((err) => {
	// 			console.log(err);
	// 		});
	// },
};
