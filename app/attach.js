// sends carrousel with related questions
async function sendQuestions(context, content) {
	const elements = [];

	content.forEach((element, index) => {
		elements.push({
			title: `Pergunta #${index + 1}`,
			subtitle: element.question,
			image_url: 'http://pngimg.com/uploads/question_mark/question_mark_PNG121.png',
			buttons: [{
				type: 'postback',
				title: 'É essa',
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