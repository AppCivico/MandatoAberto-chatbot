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
async function getIntentQR(intents) {
	const elements = [];
	// build a quick_reply options for each of the politicians available intents
	intents.forEach((element) => {
		elements.push({
			content_type: 'text',
			title: element.human_name,
			payload: `answerIntent${element.id}`,
		});
	});

	// if we have 7 options we show an option for the user to get more intents
	// TODO: what happens if we have exactly 7 intents?
	if (elements.length === 7) {
		elements.push({
			content_type: 'text',
			title: 'Mais temas',
			payload: 'moreThemes',
		});
	}

	return { quick_replies: elements };
}

module.exports.getIntentQR = getIntentQR;
