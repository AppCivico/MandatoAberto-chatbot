const request = require('requisition');

const apiUri = process.env.MANDATOABERTO_API_URL;

// let apiKey;
// let userId;

module.exports = {
	async getPoliticianData(pageId) {
		const res = await request.post(`${apiUri}/api/chatbot/politician?fb_page_id=${pageId}`);
		const politicianData = await res.json();
		return politicianData;
	},

	// getPoll(callback) {
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
	// 			options.method = 'GET';
	// 			options.url = `${apiUri}/api/chatbot/poll`;
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
