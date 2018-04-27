// This class stores text messages, urls and quick_replies options

module.exports = {
	greetings: {
		greetImage: 'https://votolegal.com.br/logo-voto-legal--89fff09e.png',
		firstMessage: 'Sou o Bot assistente do projeto Voto Legal.',
		secondMessage: 'Estou aqui para tirar dúvidas, comunicar metas e facilitar sua doação.',
		thirdMessage: `Utilize os botões abaixo para interagir`,
	},
	mainMenu: {
		menuMsg: 'Como posso te ajudar?',
		promptOptions: [
			{
				content_type: 'text',
				title: 'Doação',
				payload: 'donation',
			},
			{
				content_type: 'text',
				title: 'Status',
				payload: 'status',
			},
			{
				content_type: 'text',
				title: 'Quem pode doar?',
				payload: 'whoCanDonate',
			},
			{
				content_type: 'text',
				title: 'Voltar',
				payload: 'mainMenu',
			},
		],
	},
	donation: {
		firstMessage: 'Para fazer a doação basta tal e tal',
		secondMessage: 'Clique em uma das opções abaixo para doar:',
		donateLink: 'http://ricardoyoung.eokoe.com/candidato/#/doar',
		options: [
			{
				content_type: 'text',
				title: 'R$ 20',
				payload: 'donate1',
			},
			{
				content_type: 'text',
				title: 'R$ 50',
				payload: 'donate2',
			},
			{
				content_type: 'text',
				title: 'R$ 100',
				payload: 'donate3',
			},
			// {
			// 	content_type: 'text',
			// 	title: 'Outro Valor',
			// 	payload: 'donate4',
			// },
			{
				content_type: 'text',
				title: 'Voltar',
				payload: 'mainMenu',
			},
		],
	},
	status: {
		firstMessage: 'Temos as metas tal e tal',
		secondMessage: 'Elas estariam sendo mostradas abaixo:',
	},
	whoCanDonate: {
		firstMessage: 'O limite é de 10% de seus rendimentos brutos declarados no Imposto de Renda 2015.',
		secondMessage: 'Caso a declaração de imposto de renda seja realizada como isento, o limite é de R$ 2.812,39. Se você declarou qualquer valor de rendimento bruto no imposto de renda em 2015, mesmo que abaixo do limite da isenção, o máximo que você pode doar é 10% do declarado. Porém o limite máximo de doação via cartão de crédito é de R$ 1.064,10. ',
		thirdMessage: ' É obrigatório declarar no imposto de renda a doação. Existe uma seção específica chamada: Doações para Partidos Políticos, Comitês Financeiros e Candidatos a Cargos Eletivos. Basta informar o nome e o CNPJ do candidato para quem a doação foi realizada. ',
		fourthMessage: 'Todo doador deve ser brasileiro, maior de idade, não possuir nenhuma concessão de serviço público e ter o CPF em situação regular junto a Receita Federal Brasileira, e ser proprietário do cartão de crédito sendo que não pode ser um cartão de crédito corporativo. ',
	},
	error: {
		NoFreeText: `Perdão, eu não entendo o que vocẽ digita! Por favor, só clique nos botões.`,
	},
};
