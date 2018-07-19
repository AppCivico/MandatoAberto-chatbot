module.exports = {
    poll_suaOpiniao: {
        type: "postback",
        title: "Dê sua opinião",
        payload: "poll"
    },
    contacts: {
        type: "postback",
        title: "Contatos",
        payload: "contacts"
    },
    trajectory: {
        type: "postback",
        title: "Trajetória",
        payload: "trajectory"
    },
    doarOption: {
        type: "postback",
        title: "Participar",
        payload: "votoLegal"
    },
    goBackMainMenu: {
        type: "postback",
        title: "Voltar",
        payload: "mainMenu"
    },
    backToBeginning: {
        type: "postback",
        title: "Voltar ao início",
        payload: "mainMenu"
    },
    backToKnowMore: {
        type: "postback",
        title: "Voltar",
        payload: "knowMore"
    },
    wannaDivulgate: {
        type: "postback",
        title: "Quero Divulgar",
        payload: "WannaDivulgate"
    },
    wannaDonate: {
        type: "postback",
        title: "Quero Doar",
        payload: "WannaDonate"
    },

    recipientData_LetsGo: [ // array with two options
        {
            type: "postback",
            title: "Vamos lá!",
            payload: "recipientData"
        },
        {
            type: "postback",
            title: "Agora não",
            payload: "recipientData"
        }
    ],
    recipientData_YesNo: [ // array with two options
        {
            type: "postback",
            title: "Sim",
            payload: "recipientData"
        },
        {
            type: "postback",
            title: "Não",
            payload: "recipientData"
        },
    ],
}