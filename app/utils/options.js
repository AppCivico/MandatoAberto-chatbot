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
	keepWriting: {
		type: 'postback',
		title: 'Continuar Escrevendo',
		payload: 'talkToUs',
	},
	themeConfirmation: [ // array with two options
		{
			type: 'postback',
			title: 'Sim',
			payload: 'themeYes0',
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
	availableIntents: {
		type: 'postback',
		title: 'Propostas',
		payload: 'availableIntents',
	},
	frases_fallback: ['Essa resposta eu não tenho 🤔. Muito boa a sua pergunta! irei encaminhar para nosso time e já te respondo.',
		'Uma pergunta nova 👏👏👏! Irei encaminhar para nossa equipe, que deve responder em breve.',
		'Ainda não nos fizeram essa pergunta. Vamos descobrir a resposta 🤗 ! Vou encaminhar para nosso time.',
		'Eu não sei te responder, estou aprendendo com suas perguntas. 👨‍🎓 Vou encaminhar para nossa equipe.',
		'Humm, essa resposta eu não sei. Irei procurar com nossa equipe e te respondemos.',
		'Não encontrei sua resposta. Mas, irei encaminhar para nossa equipe, que irá te responder. 🤗'],
};
