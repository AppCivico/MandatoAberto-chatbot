const req = require('requisition');

// sends carrousel with related questions
async function sendQuestions(context, content) {
	const elements = [];

	content.forEach((element) => {
		elements.push({
			title: element.question,
			// subtitle: `Pergunta #${index + 1}`,
			// image_url: 'http://pngimg.com/uploads/question_mark/question_mark_PNG121.png',
			buttons: [{
				type: 'postback',
				title: 'Saber mais',
				payload: `answer${element.id}`,
			}],
		});
	});

	await context.sendAttachment({
		type: 'template',
		payload: {
			template_type: 'generic',
			elements,
		},
	});
}

module.exports.sendQuestions = sendQuestions;

// get quick_replies opject with elements array
async function getQR(opt, payload) {
	const elements = [];

	opt.forEach((element) => {
		elements.push({
			content_type: 'text',
			title: element,
			payload: `${payload}${element}`,
		});
	});

	return { quick_replies: elements };
}

module.exports.getQR = getQR;

// get quick_replies opject with intents array
async function getIntentQR(intents, next) {
	const elements = [];
	// build a quick_reply options for each of the politicians available intents
	intents.forEach((element) => {
		if (element.human_name.length > 20) { // removing last chars so we don't hit the title.length limit for quick_replies
			element.human_name = `${element.human_name.slice(0, 17)}...`;
		}
		elements.push({
			content_type: 'text',
			title: element.human_name,
			payload: `answerIntent${element.name}0`,
		});
	});

	// if we have 10 options we show an option for the user to get more intents. Next is the next pagination page.
	if (elements.length === 10 && next.length !== 0) {
		elements.push({ content_type: 'text', title: 'Mais temas', payload: 'moreThemes' });
	} else {
		elements.push({ content_type: 'text', title: 'Voltar', payload: 'mainMenu' });
	}

	return { quick_replies: elements };
}

module.exports.getIntentQR = getIntentQR;

function capitalizeFirstLetter(string) {
	return string.charAt(0).toUpperCase() + string.slice(1);
}

module.exports.capitalizeFirstLetter = capitalizeFirstLetter;

// get every label
async function sendButtons(id, text, buttons1, buttons2, accessToken) { // eslint-disable-line no-unused-vars
	const res = await req.post(`https://graph.facebook.com/v2.6/me/messages?access_token=${accessToken}`).send({
		recipient: {
			id,
		},
		message: {
			attachment: {
				type: 'template',
				payload: {
					template_type: 'generic',
					elements: [
						{
							title: text,
							buttons: buttons1,
						},
						{
							title: 'Escolha',
							buttons: buttons2,
						},
					],
				},
			},
		},
	});
	const response = await res.json();

	return response;
}
module.exports.sendButtons = sendButtons;
