const request = require('request-promise');
const qs = require('querystring');

const apiUri = process.env.MANDATOABERTO_API_URL

let headers = {
    'content-type': 'application/x-www-form-urlencoded'
};

var email = process.env.CHATBOT_USER_EMAIL;
var password = process.env.CHATBOT_USER_PASSWORD;

let api_key;
let user_id;

module.exports = {
    getPoliticianData: function(callback) {

        // Primeiro realizo a autenticação
        let options = {
            url: apiUri + 'api/login',
            headers: headers,
            method: 'POST',
            form:{
                email: email,
                password: password
            },
            json: true
        };
        
        request(options)
        .then((body) => {
            api_key = body.api_key;
            user_id = body.user_id;

            // Depois puxo os dados do representante público
            options.method = 'GET'
            options.url    = apiUri + 'api/politician/' + user_id;
            options.form   = { api_key: api_key };

            request(options)
            .then((body) => {
                let politician = body;
                return callback(politician);
            })
            .catch((err) => {
                console.log(err)
            });
        })
        .catch((err) => {
            console.log(err)
        });
    },

    getPoll: function(callback) {
        // Primeiro realizo a autenticação
        let options = {
            url: apiUri + 'api/login',
            headers: headers,
            method: 'POST',
            form:{
                email: email,
                password: password
            },
            json: true
        };
        
        request(options)
        .then((body) => {
            api_key = body.api_key;
            user_id = body.user_id;

            // Depois puxo os dados do representante público
            options.method = 'GET'
            options.url    = apiUri + 'api/poll';
            options.form   = { api_key: api_key };

            request(options)
            .then((body) => {
                let poll = body;
                return callback(poll);
            })
            .catch((err) => {
                console.log(err)
            });
        })
        .catch((err) => {
            console.log(err)
        });
    }
}