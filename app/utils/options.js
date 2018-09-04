module.exports = {
	poll_suaOpiniao: {
		type: 'postback',
		title: 'Dê sua opinião',
		payload: 'poll',
	},
	aboutPolitician: {
		type: 'postback',
		title: 'Saiba mais',
		payload: 'aboutMe',
	},
	contacts: {
		type: 'postback',
		title: 'Contatos',
		payload: 'contacts',
	},
	trajectory: {
		type: 'postback',
		title: 'Trajetória',
		payload: 'trajectory',
	},
	participate: {
		type: 'postback',
		title: 'Participar',
		payload: 'participateMenu',
	},
	goBackMainMenu: {
		type: 'postback',
		title: 'Voltar',
		payload: 'mainMenu',
	},
	backToBeginning: {
		type: 'postback',
		title: 'Voltar ao início',
		payload: 'mainMenu',
	},
	backToKnowMore: {
		type: 'postback',
		title: 'Voltar',
		payload: 'knowMore',
	},
	wannaDivulgate: {
		type: 'postback',
		title: 'Quero Divulgar',
		payload: 'WannaDivulgate',
	},
	wannaDonate: {
		type: 'postback',
		title: 'Quero Doar',
		payload: 'WannaDonate',
	},
	AboutDonation: {
		type: 'postback',
		title: 'Sobre doações',
		payload: 'aboutDonation',
	},
	AboutDivulgation: {
		type: 'postback',
		title: 'Sobre divulgar',
		payload: 'aboutDivulgation',
	},
	writeMessage: {
		type: 'postback',
		title: 'Escrever Mensagem',
		payload: 'listening',
	},
	seeAssistent: {
		type: 'postback',
		title: 'Conhecer Assistente',
		payload: 'mainMenu',
	},
	leaveInfo: {
		type: 'postback',
		title: 'Deixar Contato',
		payload: 'recipientData',
	},
	talkToUs: {
		type: 'postback',
		title: 'Fale conosco',
		payload: 'talkToUs',
	},
	themeConfirmation: [ // array with two options
		{
			type: 'postback',
			title: 'Sim',
			payload: 'themeYes',
		},
		{
			type: 'postback',
			title: 'Não',
			payload: 'NotOneOfThese',
		},
	],
	recipientData_LetsGo: [ // array with two options
		{
			type: 'postback',
			title: 'Vamos lá!',
			payload: 'recipientData',
		},
		{
			type: 'postback',
			title: 'Agora não',
			payload: 'recipientData',
		},
	],
	recipientData_YesNo: [ // array with two options
		{
			type: 'postback',
			title: 'Sim',
			payload: 'recipientData',
		},
		{
			type: 'postback',
			title: 'Não',
			payload: 'recipientData',
		},
	],
	votoLegal_participateOptions: [
		{
			type: 'postback',
			title: 'Sim',
			payload: 'WannaHelp',
		},
		{
			type: 'postback',
			title: 'Não',
			payload: 'mainMenu',
		},
		{
			type: 'postback',
			title: 'Saber mais',
			payload: 'knowMore',
		},
	],
	frases_fallback: ['Essa resposta eu não tenho 🤔. Muito boa a sua pergunta! irei encaminhar para nosso time e já te respondo.',
		'Uma pergunta nova 👏👏👏! Irei encaminhar para nossa equipe, que deve responder em breve.',
		'Ainda não fizeram pergunta. Vamos descobrir a resposta 🤗 ! Vou encaminhar para nosso time.',
		'Eu não sei te responder, estou aprendendo com suas perguntas. 👨‍🎓 Vou encaminhar para nossa equipe.',
		'Humm, essa resposta eu não sei. Irei procurar com nossa equipe e te respondemos.',
		'Não encontrei sua resposta. Mas, irei encaminhar para nossa equipe, que irá te responder. 🤗'],
};
