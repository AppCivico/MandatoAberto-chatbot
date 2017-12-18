const request = require('request-promise');
// const qs = require('querystring');

const apiUri = process.env.MANDATOABERTO_API_URL;

const headers = {
	'content-type': 'application/x-www-form-urlencoded',
};

// let apiKey;
// let userId;

module.exports = {
	getPoliticianData(pageId, callback) {
		// Primeiro realizo a autenticação
		const options = {
			url: `${apiUri}/api/chatbot?fb_page_id=${pageId}`,
			headers,
			method: 'GET',
			json: true,
		};

		request(options)
			.then((body) => {
				const res = body;
				console.log(res);

				return callback(res.access_token);
			})
			.catch((err) => {
				console.log(err);
			});
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
