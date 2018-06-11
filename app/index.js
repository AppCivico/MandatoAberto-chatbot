require("dotenv").config();

const { MessengerBot, FileSessionStore, withTyping } = require("bottender");
const { createServer } = require("bottender/restify");
const config = require("./bottender.config.js").messenger;
const MandatoAbertoAPI = require("./mandatoaberto_api.js");
const VotoLegalAPI = require("./votolegal_api.js");
const Articles = require("./utils/articles.js");
const request = require("requisition");

const apiUri = process.env.MANDATOABERTO_API_URL;

const phoneRegex = new RegExp(/^\+55\d{2}(\d{1})?\d{8}$/);

function getMoney(str) {
  return parseInt(str.replace(/[\D]+/g, ""));
}
function formatReal(int) {
  var tmp = int + "";
  tmp = tmp.replace(/([0-9]{2})$/g, ",$1");
  if (tmp.length > 6) {
    tmp = tmp.replace(/([0-9]{3}),([0-9]{2}$)/g, ".$1,$2");
  }
  return tmp;
}

let articles;
let politicianData;
let pollAnswer;
let trajectory;
let promptOptions;
let participateOptions;
let recipient;
let issue_message;

let pollData = {};
let recipientData = {};

const limit = 10000 * 2;
let timer;
// let userMessage = "";
let sendIntro = true;
// areWeListening is used to diferenciate messages that come from
// the standard flow and messages from comment/post
let areWeListening = false;

recipientData[
  ("fb_id", "name", "origin_dialog", "email", "cellphone", "gender")
];

const mapPageToAccessToken = async pageId => {
  politicianData = await MandatoAbertoAPI.getPoliticianData(pageId);
  pollData = await MandatoAbertoAPI.getPollData(pageId);
  trajectory = await MandatoAbertoAPI.getAnswer(
    politicianData.user_id,
    "trajectory"
  );

  // Deve-se indentificar o sexo do representante público
  // e selecionar os artigos (definido e possesivo) adequados
  if (politicianData.gender === "F") {
    articles = Articles.feminine;
  } else {
    articles = Articles.masculine;
  }

  return politicianData.fb_access_token;
};

const bot = new MessengerBot({
  mapPageToAccessToken,
  appSecret: config.appSecret,
  sessionStore: new FileSessionStore()
});

bot.setInitialState({});

bot.use(withTyping({ delay: 1000 }));

bot.onEvent(async context => {
  function getMenuPrompt() {
    // both of these verifications were on greetings dialog, now they're both at greeting and mainMenu
    areWeListening = true;
    if (
      politicianData.office.name === "Outros" ||
      politicianData.office.name === "Candidato" ||
      politicianData.office.name === "Candidata"
    ) {
      about_me_text = `Sobre ${articles.defined} líder`;
    } else if (
      politicianData.office.name === "pré-candidato" ||
      politicianData.office.name === "pré-candidata"
    ) {
      about_me_text = `${articles.defined} ${politicianData.office.name}`;
    } else {
      about_me_text = `Sobre ${articles.defined} ${politicianData.office.name}`;
    }

    if (introduction.content && pollData.questions) {
      promptOptions = [
        // {
        // 	content_type: 'text',
        // 	title: 'Fale conosco',
        // 	payload: 'issue'
        // },
        {
          type: "postback",
          title: about_me_text,
          payload: "aboutMe"
        },
        {
          type: "postback",
          title: "Dê sua opinião",
          payload: "poll"
        }
      ];
    } else if (introduction.content && !pollData.questions) {
      promptOptions = [
        // {
        // 	content_type: 'text',
        // 	title: 'Fale conosco',
        // 	payload: 'issue'
        // },
        {
          type: "postback",
          title: about_me_text,
          payload: "aboutMe"
        }
      ];
    } else if (!introduction.content && pollData.questions) {
      promptOptions = [
        // {
        // 	content_type: 'text',
        // 	title: 'Fale conosco',
        // 	payload: 'issue'
        // },
        {
          type: "postback",
          title: "Dê sua opinião",
          payload: "poll"
        }
      ];
    } else if (
      !introduction.content &&
      !pollData.questions &&
      politicianData.contact
    ) {
      promptOptions = [
        // {
        // 	content_type: 'text',
        // 	title: 'Fale conosco',
        // 	payload: 'issue'
        // },
        {
          type: "postback",
          title: "Contatos",
          payload: "contacts"
        }
      ];
    }
    if (politicianData.votolegal_integration) {
      if (
        politicianData.votolegal_integration.votolegal_url &&
        politicianData.votolegal_integration.votolegal_username &&
        politicianData.picframe_url
      ) {
        // check if integration to votoLegal exists to add the donation option
        // politicianData.votolegal_integration.votolegal_url will be used in a future web_url button to link to the donation page
        const doarOption = {
          type: "postback",
          title: "Participar",
          payload: "votoLegal"
        };
        promptOptions.push(doarOption);
      }
    }
  }

  // Abrindo bot através de comentários e posts
  if (context.event.rawEvent.field === "feed") {
    let item;
    let comment_id;
    let permalink;
    let introduction;
    let about_me_text;
    const post_id = context.event.rawEvent.value.post_id;
    const page_id = post_id.substr(0, post_id.indexOf("_"));
    // console.log('context.event', context.event);
    // console.log('context.raw', context.event.rawEvent.value.from.id);
    areWeListening = false;

    switch (context.event.rawEvent.value.item) {
      
      case "comment":
        item = "comment";
        comment_id = context.event.rawEvent.value.comment_id;
        permalink = context.event.rawEvent.value.post.permalink_url;
        await MandatoAbertoAPI.postPrivateReply(
          item,
          page_id,
          post_id,
          comment_id,
          permalink
        );
        break;
      case "post":
        item = "post";
        await MandatoAbertoAPI.postPrivateReply(
          item,
          page_id,
          post_id,
          comment_id,
          permalink
        );
        break;
    }
  }

  // Tratando caso de o político não ter dados suficientes
  if (!context.state.dialog) {
    if (
      !politicianData.greetings &&
      (!politicianData.contact && !pollData.questions)
    ) {
      console.log("Politician does not have enough data");
      return false;
    }
    await context.resetState();
    await context.setState({ dialog: "greetings" });
  }

  // Tratando botão GET STARTED
  if (context.event.postback && context.event.postback.payload === "greetings") {
    await context.resetState();
    await context.setState({ dialog: "greetings" });
  }

  // Tratando dinâmica de issues
  if (context.state.dialog === "prompt") {
    if (context.event.isPostback) {
      const payload = context.event.postback.payload;
      await context.setState({ dialog: payload });
    } else if (context.event.isQuickReply) {
      await context.setState({ dialog: context.event.message.quick_reply.payload });
    } else if (context.event.isText) {
      // Ao mandar uma mensagem que não é interpretada como fluxo do chatbot
      // Devo já criar uma issue
      // We go to the listening dialog to wait for other messages
      if (areWeListening === true) {
        // check if message came from standard flow or from post/comment
        await context.setState({ dialog: "listening" });
      } else {
        await context.setState({ dialog: "intermediate" });
      }
    }
  }

  // Switch de dialogos
  if (context.event.isPostback && (context.state.dialog === "prompt" || context.event.postback.payload === "greetings")) {
    const payload = context.event.postback.payload;
    await context.setState({ dialog: payload });
  } else if (context.event.isPostback && context.state.dialog === "listening" ) {
    await context.typingOff();
    const payload = context.event.postback.payload;
    if (payload === "mainMenu") {
      console.log('antes de mandar:', context.state.userMessage);
      await MandatoAbertoAPI.postIssue(
        politicianData.user_id,
        context.session.user.id,
        context.state.userMessage
      );
      await context.setState({ userMessage: ''});
      console.log('depois de mandar:', context.state.userMessage);

    } else if (context.event.message) {
        console.log('Passei aqui');
        context.event.message.text = "";
    }
    if (context.event.isQuickReply) { // because of the issue response
      const payload = context.event.quick_reply.payload;
      await context.setState({ dialog: payload });
    } else {
      await context.setState({ dialog: payload });
    }
  }
  // Resposta de enquete
  const propagateIdentifier = "pollAnswerPropagate";
  if (context.event.isPostback && context.state.dialog === "pollAnswer") {
    poll_question_option_id = context.event.postback.payload;
    const origin = "dialog";
    await MandatoAbertoAPI.postPollAnswer(
      context.session.user.id,
      poll_question_option_id,
      origin
    );
  } else if (
    context.event.isPostback &&
    context.event.postback.payload &&
    context.event.postback.payload.includes(propagateIdentifier)
  ) {
    // Tratando resposta da enquete através de propagação
    const payload = context.event.postback.payload;
    poll_question_option_id = payload.substr(
      payload.indexOf("_") + 1,
      payload.length
    );
    const origin = "propagate";
    await MandatoAbertoAPI.postPollAnswer(
      context.session.user.id,
      poll_question_option_id,
      origin
    );
    context.setState({ dialog: "pollAnswer" });
  } else if (context.event.isText && context.state.dialog === "pollAnswer") {
    await context.setState({ dialog: "listening" });
  }
  // Tratando dados adicionais do recipient
  if (context.state.dialog === "recipientData" && context.state.recipientData) {
    if (context.state.recipientData) {
      switch (context.state.recipientData) {
        case "email":
          recipientData.fb_id = context.session.user.id;
          recipientData.email = context.event.message.text;
          await MandatoAbertoAPI.postRecipient(
            politicianData.user_id,
            recipientData
          );
          recipientData = {};
          await context.sendButtonTemplate("Legal, agora quer me informar seu telefone, para lhe manter informado sobre outras enquetes?",
            [
              {
                type: "postback",
                title: "Sim",
                payload: "recipientData"
              },
              {
                type: "postback",
                title: "Não",
                payload: "recipientData"
              }
            ]
          );
          await context.setState({
            recipientData: "cellphonePrompt",
            dialog: "recipientData",
            dataPrompt: ""
          });
          break;
        case "cellphone":
          recipientData.fb_id = context.session.user.id;
          recipientData.cellphone = context.event.message.text;
          recipientData.cellphone = recipientData.cellphone.replace(
            /[- .)(]/g,
            ""
          );
          recipientData.cellphone = `+55${recipientData.cellphone}`;

          if (phoneRegex.test(recipientData.cellphone)) {
            await MandatoAbertoAPI.postRecipient(
              politicianData.user_id,
              recipientData
            );
          } else {
            await context.setState({
              dataPrompt: "",
              recipientData: "cellphonePrompt"
            });

            await context.sendText(
              "Desculpe-me, mas seu telefone não parece estar correto. Não esqueça de incluir o DDD. " +
                "Por exemplo: 1199999-8888"
            );
                  await context.sendButtonTemplate("Vamos tentar de novo?", [
              {
                type: "postback",
                title: "Sim",
                payload: "recipientData"
              },
              {
                type: "postback",
                title: "Não",
                payload: "recipientData"
              }
            ]);
          }

          recipientData = {};
          break;
        case "cellphonePrompt":
          await context.setState({
            dialog: "recipientData",
            dataPrompt: "cellphone"
          });
          break;
      }
    }
  }

  switch (context.state.dialog) {
    case "greetings":
      // Criando um cidadão
      recipientData.fb_id = context.session.user.id;
      recipientData.name = `${context.session.user.first_name} ${ context.session.user.last_name}`;
      recipientData.gender = context.session.user.gender === "male" ? "M" : "F";
      recipientData.origin_dialog = "greetings";
      recipientData.picture = context.session.user.profile_pic;
      recipient = await MandatoAbertoAPI.postRecipient(
        politicianData.user_id,
        recipientData
      );
      recipientData = {};
      introduction = await MandatoAbertoAPI.getAnswer(politicianData.user_id, "introduction");
      issue_message = await MandatoAbertoAPI.getAnswer(politicianData.user_id, "issue_acknowledgment");
      if (Object.keys(issue_message).length === 0) {
        issue_message =
          "A qualquer momento você pode digitar uma mensagem e eu enviarei para o gabinete.";
      } else {
        issue_message = issue_message.content;
      }
      await getMenuPrompt();
      console.log('antes de limpar:', context.state.userMessage);
      await context.setState({userMessage: ""}) // cleaning up
      console.log('depois de limpar:', context.state.userMessage);
      let greeting = politicianData.greeting.replace(
        "${user.office.name}",
        politicianData.office.name
      );
      greeting = greeting.replace("${user.name}", politicianData.name);
      await context.sendText(greeting);
      await context.sendButtonTemplate(issue_message, promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "mainMenu": // after issue is created we come back to this dialog
      // introduction and about_me_text aren't declared inside of greetings anymore. What's defined there is accessible here.

      // Criando um cidadão
       recipientData.fb_id = context.session.user.id;
      recipientData.name = `${context.session.user.first_name} ${context.session.user.last_name}`;
      recipientData.gender = context.session.user.gender === "male" ? "M" : "F";
      recipientData.origin_dialog = "greetings";
      recipientData.picture = context.session.user.profile_pic;
      recipient = await MandatoAbertoAPI.postRecipient(
        politicianData.user_id,
        recipientData
      );
      recipientData = {};

      introduction = await MandatoAbertoAPI.getAnswer(
        politicianData.user_id,
        "introduction"
      );
      issue_message = await MandatoAbertoAPI.getAnswer(
        politicianData.user_id,
        "issue_acknowledgment"
      );

      if (Object.keys(issue_message).length === 0) {
        issue_message = "A qualquer momento você pode digitar uma mensagem e eu enviarei para o gabinete.";
      } else {
        issue_message = issue_message.content;
      }
      await getMenuPrompt();
      console.log('antes de limpar:', context.state.userMessage);
      await context.setState({ userMessage: "" }) // cleaning up
      console.log('depois de limpar:', context.state.userMessage);
      await context.sendButtonTemplate("Como posso te ajudar?", promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "intermediate":
    // await context.setState({ userMessage: `${context.state.userMessage} + " "`});;
      await context.sendText(`Vocês gostaria de enviar uma mensagem para nossa equipe ou conhecer mais sobre ` + 
        `${articles.defined} ${politicianData.office.name} ${politicianData.name}?`);
      promptOptions = [
        {
          type: "postback",
          title: "Escrever Mensagem",
          payload: "listening"
        },
        {
          type: "postback",
          title: "Conhecer Assistente",
          payload: "mainMenu"
        }
      ];
      await context.sendButtonTemplate("Selecione a opção desejada em um dos botões abaixo:", promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "votoLegal":
      participateOptions = [
        {
          type: "postback",
          title: "Sim",
          payload: "WannaHelp"
        },
        {
          type: "postback",
          title: "Não",
          payload: "mainMenu"
        }
      ];
      await context.sendText(
        "Você sabia que estamos em pré-campanha e contamos com sua participação?"
      );
      await context.sendButtonTemplate("Quer fazer parte?", participateOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "WannaHelp":
      participateOptions = [
        {
          type: "postback",
          title: "Quero Doar",
          payload: "WannaDonate"
        },
        {
          type: "postback",
          title: "Quero Divulgar",
          payload: "WannaDivulgate"
        },
        {
          type: "postback",
          title: "Voltar",
          payload: "mainMenu"
        }
      ];
      await context.sendButtonTemplate(
        "Muito bom poder contar com você! Como deseja participar?",
        participateOptions
      );
      await context.setState({ dialog: "prompt" });
      break;
    case "WannaDonate":
      participateOptions = [
        {
          type: "web_url",
          url: politicianData.votolegal_integration.votolegal_url,
          title: "Vamos lá!"
        },
        {
          type: "postback",
          title: "Quero Divulgar",
          payload: "WannaDivulgate"
        },
        {
          type: "postback",
          title: "Voltar",
          payload: "mainMenu"
        }
      ];
      await context.sendText(
        "Muito bom! Fico muito feliz com sua contribuição."
      );
      const valueLegal = await VotoLegalAPI.getVotoLegalValues(politicianData.votolegal_integration.votolegal_username);
      await context.sendText(
        `Já consegui R$${formatReal(valueLegal.candidate.total_donated)} da ` +
          `minha meta de R$${formatReal(
            getMoney(valueLegal.candidate.raising_goal)
          )}.`
      );
      await context.sendButtonTemplate(
        "Você deseja doar agora?",
        participateOptions
      );
      await context.setState({ dialog: "prompt" });
      break;
    case "WannaDivulgate":
      participateOptions = [
        {
          type: "web_url",
          url: politicianData.picframe_url,
          title: "Atualizar foto"
        },
        {
          type: "postback",
          title: "Quero Doar",
          payload: "WannaDonate"
        },
        {
          type: "postback",
          title: "Voltar",
          payload: "mainMenu"
        }
      ];
      await context.sendButtonTemplate(
        "Que legal! Seu apoio é muito importante para nós! " +
          "\nVocê quer mudar foto (avatar) do seu perfil?",
        participateOptions
      );
      await context.setState({ dialog: "prompt" });
      break;
    case "listening":
      // When user enters with text, prompt sends us here
      // if it's the first message we warn the user that we are listening and wait for 60s for a new message
      // we keep adding new messages on top of each other until user stops for 60s, then we can save the issue and go back to the menu
      if (sendIntro === true) {
        await context.sendText(
          "Vejo que você está escrevendo. Seu contato é muito importante. Quando terminar, entrego sua mensagem para nossa equipe."
        );
        sendIntro = false;
      }
      await context.typingOn();
      clearTimeout(timer);
      if (context.event.message) {
        console.log('antes de timer:', context.state.userMessage);
        await context.setState({ userMessage: `${context.state.userMessage} + " "`});;
        console.log('depois de timer:', context.state.userMessage);
      }
      timer = setTimeout(async () => {
        sendIntro = true;
        const issue_created_message = await MandatoAbertoAPI.getAnswer(
          politicianData.user_id,
          "issue_created"
        );
        let endMessage;
        if (issue_created_message.content) {
          endMessage =
            issue_created_message.content +
            "\nVocê terminou de escrever sua mensagem?";
        } else {
          endMessage = "Você terminou de escrever sua mensagem?";
        }
        await context.sendButtonTemplate(endMessage, [
            {
              type: "postback",
              title: "Terminei a mensagem",
              payload: "mainMenu"
            },
            {
              type: "postback",
              title: "Continuar escrevendo",
              payload: "listening"
            }
          ]);
      }, limit);
      break;
    case "aboutMe":
      const introductionText = await MandatoAbertoAPI.getAnswer(
        politicianData.user_id,
        "introduction"
      );
      await context.sendText(introductionText.content);

      if (trajectory.content && pollData.questions) {
        promptOptions = [
          {
            type: "postback",
            title: "Trajetória",
            payload: "trajectory"
          },
          {
            type: "postback",
            title: "Contatos",
            payload: "contacts"
          }
        ];
      } else if (trajectory.content && !pollData.questions) {
        promptOptions = [
          {
            type: "postback",
            title: "Trajetória",
            payload: "trajectory"
          }
        ];
      } else if (!trajectory.content && pollData.questions) {
        promptOptions = [
          {
            type: "postback",
            title: "Contatos",
            payload: "contacts"
          }
        ];
      }
      if (politicianData.votolegal_integration) {
        if (
          politicianData.votolegal_integration.votolegal_url &&
          politicianData.votolegal_integration.votolegal_username
        ) {
          // check if integration to votoLegal exists to add the donation option
          // politicianData.votolegal_integration.votolegal_url will be used in a future web_url button to link to the donation page
          const doarOption = {
            type: "postback",
            title: "Participar",
            payload: "votoLegal"
          };
          promptOptions.push(doarOption);
        }
      }
      await context.sendButtonTemplate(`O que mais deseja saber sobre ${articles.defined} ${politicianData.office.name}?`, promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "contacts":
      // Tratando o formato do telefone
      if (politicianData.contact.cellphone) {
        politicianData.contact.cellphone = politicianData.contact.cellphone.replace(
          /(?:\+55)+/g,
          ""
        );
        politicianData.contact.cellphone = politicianData.contact.cellphone.replace(
          /^(\d{2})/g,
          "($1)"
        );
      }

      await context.sendText(
        `Você pode entrar em contato com ${articles.defined} ${
          politicianData.office.name
        } ${politicianData.name} pelos seguintes canais:`
      );

      if (politicianData.contact.email) {
        await context.sendText(
          ` - Através do e-mail: ${politicianData.contact.email}`
        );
      }
      if (politicianData.contact.cellphone) {
        await context.sendText(
          ` - Através do WhatsApp: ${politicianData.contact.cellphone}`
        );
      }
      if (politicianData.contact.twitter) {
        await context.sendText(
          ` - Através do Twitter: ${politicianData.contact.twitter}`
        );
      }
      if (politicianData.contact.url) {
        await context.sendText(
          ` - Através do site: ${politicianData.contact.url}`
        );
      }

      if (trajectory.content && pollData.questions) {
        promptOptions = [
          {
            type: "postback",
            title: "Trajetória",
            payload: "trajectory"
          },
          {
            type: "postback",
            title: "Dê sua opinião",
            payload: "poll"
          }
        ];
      } else if (trajectory.content && !pollData.questions) {
        promptOptions = [
          {
            type: "postback",
            title: "Trajetória",
            payload: "trajectory"
          }
        ];
      } else if (!trajectory.content && pollData.questions) {
        promptOptions = [
          {
            type: "postback",
            title: "Dê sua opinião",
            payload: "poll"
          }
        ];
      }
      if (politicianData.votolegal_integration) {
        if (
          politicianData.votolegal_integration.votolegal_url &&
          politicianData.votolegal_integration.votolegal_username
        ) {
          // check if integration to votoLegal exists to add the donation option
          // politicianData.votolegal_integration.votolegal_url will be used in a future web_url button to link to the donation page
          const doarOption = {
            type: "postback",
            title: "Participar",
            payload: "votoLegal"
          };
          promptOptions.push(doarOption);
        }
      }
      await context.sendButtonTemplate("Quer saber mais?", promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "poll":
      // Verifico se o cidadão já respondeu a enquete atualmente ativa
      const recipientAnswer = await MandatoAbertoAPI.getPollAnswer(
        context.session.user.id,
        pollData.id
      );
      if (trajectory.content && politicianData.contact) {
        promptOptions = [
          {
            type: "postback",
            title: "Trajetória",
            payload: "trajectory"
          },
          {
            type: "postback",
            title: "Contatos",
            payload: "contacts"
          }
        ];
      } else if (trajectory.content && !politicianData.contact) {
        promptOptions = [
          {
            type: "postback",
            title: "Trajetória",
            payload: "trajectory"
          }
        ];
      } else if (!trajectory.content && politicianData.contact) {
        promptOptions = [
          {
            type: "postback",
            title: "Contatos",
            payload: "contacts"
          }
        ];
      }
      if (politicianData.votolegal_integration) {
        if (
          politicianData.votolegal_integration.votolegal_url &&
          politicianData.votolegal_integration.votolegal_username
        ) {
          // check if integration to votoLegal exists to add the donation option
          // politicianData.votolegal_integration.votolegal_url will be used in a future web_url button to link to the donation page
          const doarOption = {
            type: "postback",
            title: "Participar",
            payload: "votoLegal"
          };
          promptOptions.push(doarOption);
        }
      }
      // Agora a enquete poderá ser respondida via propagação ou via dialogo
      if (recipientAnswer.recipient_answered >= 1) {
        await context.sendText("Ah, que pena! Você já respondeu essa enquete.");
        await context.sendButtonTemplate("Se quiser, eu posso te ajudar com outra coisa.", promptOptions);
        await context.setState({ dialog: "prompt" });
      } else {
        await context.sendText(
          "Quero conhecer você melhor. Deixe sua resposta e participe deste debate."
        );
        await context.sendButtonTemplate(`Pergunta: ${pollData.questions[0].content}` ,
          [
            {
              type: "postback",
              title: pollData.questions[0].options[0].content,
              payload: `${pollData.questions[0].options[0].id}`
            },
            {
              type: "postback",
              title: pollData.questions[0].options[1].content,
              payload: `${pollData.questions[0].options[1].id}`
            }
          ]
        );
        await context.setState({ dialog: "pollAnswer" });
      }
      break;
    case "pollAnswer":
      await context.sendButtonTemplate( "Muito obrigado por sua resposta. Você gostaria de deixar seu e-mail e telefone para nossa equipe?",
        [
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
        ]
      );

      await context.setState({
        dialog: "prompt",
        dataPrompt: "email"
      });

      break;
    case "recipientData":
    if (context.event.postback && (context.event.postback.title === "Agora não" || context.event.postback.title === "Não")) {
        await context.sendButtonTemplate("Está bem! Posso te ajudar com mais alguma informação?", promptOptions);
        await context.setState({ dialog: "prompt" });
      } else if (context.state.dataPrompt) {
        switch (context.state.dataPrompt) {
          case "email":
            await context.sendText("Qual é o seu e-mail?");
            await context.setState({
              dialog: "recipientData",
              recipientData: "email"
            });
            break;
          case "cellphone":
            await context.sendText(
              "Qual é o seu telefone? Não deixe de incluir o DDD."
            );
            await context.setState({
              dialog: "recipientData",
              recipientData: "cellphone",
              dataPrompt: "end"
            });
            break;
          case "cellphoneFail":
            break;
          case "end":
            await context.sendText("Pronto, já guardei seus dados.");
            await context.sendButtonTemplate("Quer saber mais?", promptOptions);
            await context.setState({ dialog: "prompt" });
            break;
        }
      }
      break;
    case "trajectory":
      await context.sendText(trajectory.content);
      if (pollData.questions && politicianData.contact) {
        promptOptions = [
          {
            type: "postback",
            title: "Dê sua opinião",
            payload: "poll"
          },
          {
            type: "postback",
            title: "Contatos",
            payload: "contacts"
          }
        ];
      } else if (pollData.questions && !politicianData.contact) {
        promptOptions = [
          {
            type: "postback",
            title: "Dê sua opinião",
            payload: "poll"
          }
        ];
      } else if (!pollData.questions && politicianData.contact) {
        promptOptions = [
          {
            type: "postback",
            title: "Contatos",
            payload: "contacts"
          }
        ];
      }
      if (politicianData.votolegal_integration) {
        if (
          politicianData.votolegal_integration.votolegal_url &&
          politicianData.votolegal_integration.votolegal_username
        ) {
          // check if integration to votoLegal exists to add the donation option
          // politicianData.votolegal_integration.votolegal_url will be used in a future web_url button to link to the donation page
          const doarOption = {
            type: "postback",
            title: "Participar",
            payload: "votoLegal"
          };
          promptOptions.push(doarOption);
        }
      }
      await context.sendButtonTemplate("Quer saber mais?" , promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "issue":
      await context.sendText("Escreva sua mensagem para nossa equipe:");
      await context.setState({
        dialog: "prompt",
        prompt: "issue"
      });
      break;
    case "issue_created":
      const issue_created_message = await MandatoAbertoAPI.getAnswer(
        politicianData.user_id,
        "issue_created"
      );
      await context.sendButtonTemplate(issue_created_message.content, [
          {
            type: "postback",
            title: "Voltar ao início",
            payload: "mainMenu"
          }
        ]
      );
      await context.setState({ dialog: "prompt" });
      break;
  }
});

const server = createServer(bot, { verifyToken: config.verifyToken });

server.listen(process.env.API_PORT, () => {
  console.log(`server is running on ${process.env.API_PORT} port...`);
});
