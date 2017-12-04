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
function auth(getPoliticianData) {
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

    request(options, getPoliticianData)
    .then((body) => {
        api_key = body.api_key;
        user_id = body.user_id;
        return getPoliticianData(api_key, user_id);
    })
    .catch((err) => {
        console.log(err)
    });
}

module.exports = {
    greetings: function() {

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
                console.log(politician);
            })
        })
        .catch((err) => {
            console.log(err)
        });
    },
}

// module.exports = {
//     greetings: function() {
//         auth(getPoliticianData);

//         function getPoliticianData(api_key, user_id) {
            
//             let options = {
//                 url: apiUri + 'api/politician/' + user_id,
//                 headers: headers,
//                 method: 'GET',
//                 form:{ api_key: api_key },
//                 json: true
//             };

//             request(options)
//                 .then((body) => {
//                     console.log(body);
//                 })
//                 .catch((err) => {
//                     console.log(err)
//                 });
//         }
//     },
// }