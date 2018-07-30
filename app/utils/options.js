module.exports = {
	poll_suaOpiniao: {
		type: 'postback',
		title: 'Dê sua opinião',
		payload: 'poll',
	},
	aboutPolitician: {
		type: 'postback',
		title: 'Sobre', // ony a template, will be filled with the proper title before it's used
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
	doarOption: {
		type: 'postback',
		title: 'Participar',
		payload: 'votoLegal',
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
};
