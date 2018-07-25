require("dotenv").config();

const { MessengerBot, FileSessionStore, withTyping } = require("bottender");
const { createServer } = require("bottender/restify");
const config = require("./bottender.config.js").messenger;
const MandatoAbertoAPI = require("./mandatoaberto_api.js");
const VotoLegalAPI = require("./votolegal_api.js");
const Articles = require("./utils/articles.js");
const opt = require('./utils/options');

// const request = require("requisition");
// const apiUri = process.env.MANDATOABERTO_API_URL;

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

let promptOptions;
let recipient;

const limit = 10000 * 2;
let timer;
// userMessage -> context.state.userMessage -> stores the texts the user wirtes before sending them to politician [issue] 
// sendIntro = true -> context.state.sendIntro -> verifies if we should send the intro text for issue creation.
let areWeListening = false;
// areWeListening -> user.state.areWeListening(doesn't work) -> diferenciates messages that come from
// the standard flow and messages from comment/post
// 

const mapPageToAccessToken = async pageId => {
  const politicianData2 = await MandatoAbertoAPI.getPoliticianData(pageId);
  return politicianData2.fb_access_token;
};

const bot = new MessengerBot({
  mapPageToAccessToken,
  appSecret: config.appSecret,
  sessionStore: new FileSessionStore()
});

bot.setInitialState({});

bot.use(withTyping({ delay: 1000 }));

// Deve-se indentificar o sexo do representante público e selecionar os artigos (definido e possesivo) adequados
function getArticles(gender) {
  if (gender === "F") {
    return Articles.feminine;
  } else {
    return Articles.masculine;
  }
};

function getAboutMe(politicianData) {
  let articles = getArticles(politicianData.gender); 

  if (politicianData.office.name === "Outros" || politicianData.office.name === "Candidato" || politicianData.office.name === "Candidata") {
    return `Sobre ${articles.defined} líder`;
  } else if (politicianData.office.name === "pré-candidato" || politicianData.office.name === "pré-candidata") {
    return `${articles.defined.toUpperCase()} ${politicianData.office.name}`;
  } else {
    return `Sobre ${articles.defined} ${politicianData.office.name}`;
  }
};

function checkMenu(context, opt2) { // eslint-disable-line no-inner-declarations
  let dialogs = opt2;
  console.log('Running')
  if (!context.state.introduction.content) { dialogs = dialogs.filter(obj => obj.payload !== 'aboutMe'); }
  if (!context.state.trajectory) { dialogs = dialogs.filter(obj => obj.payload !== 'trajectory');}
  if (!context.state.pollData) { dialogs = dialogs.filter(obj => obj.payload !== 'poll'); }
  if (!context.state.politicianData.contact) { dialogs = dialogs.filter(obj => obj.payload !== 'contacts');}
  if (!context.state.politicianData.votolegal_integration) { dialogs = dialogs.filter(obj => obj.payload !== 'votoLegal');}
  if (dialogs.aboutPolitician) { dialogs.aboutPolitician.title = await getAboutMe(context.state.politicianData); }
  console.log(dialogs);
  return dialogs;
}

function getIssueMessage(issueMessage) {
  if (Object.keys(issueMessage).length === 0) {
    return "A qualquer momento você pode digitar uma mensagem que enviarei para nosso time.";
  } else {
    return issueMessage.content;
  }
};

bot.onEvent(async context => {
  if (!context.event.isDelivery && !context.event.isEcho && !context.event.isRead) {
    // we reload politicianData on every useful event
    await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
    // we update user data at every interaction
    await MandatoAbertoAPI.postRecipient(context.state.politicianData.user_id, {
      fb_id: context.session.user.id,
      name: `${context.session.user.first_name} ${context.session.user.last_name}`,
      gender: context.session.user.gender === "male" ? "M" : "F",
      origin_dialog: "greetings",
      picture: context.session.user.profile_pic
    });
  }

  function getMenuPrompt(context) {
    if (context.state.introduction.content && context.state.pollData.questions) {
      promptOptions = [
        {
          type: "postback",
          title: context.state.aboutMeText,
          payload: "aboutMe"
        },
        opt.poll_suaOpiniao,
      ];
    } else if (context.state.introduction.content && !context.state.pollData.questions) {
      promptOptions = [
        {
          type: "postback",
          title: context.state.aboutMeText,
          payload: "aboutMe"
        }
      ];
    } else if (!context.state.introduction.content && context.state.pollData.questions) {
      promptOptions = [opt.poll_suaOpiniao];
    } else if (!context.state.introduction.content && !context.state.pollData.questions && context.state.politicianData.contact) {
      promptOptions = [opt.contacts];
    }
    if (context.state.politicianData.votolegal_integration) {
      if (context.state.politicianData.votolegal_integration.votolegal_url && context.state.politicianData.votolegal_integration.votolegal_username) {
        // check if integration to votoLegal exists to add the donation option
        // politicianData.votolegal_integration.votolegal_url will be used in a future web_url button to link to the donation page
        promptOptions.push(opt.doarOption);
      }
    }
  }

  // Abrindo bot através de comentários e posts
  // ** no context here **
  if (context.event.rawEvent.field === "feed") {
    let item;
    let comment_id;
    let permalink;
    // let introduction;
    const post_id = context.event.rawEvent.value.post_id;
    const page_id = post_id.substr(0, post_id.indexOf("_"));
    let user_id = context.event.rawEvent.value.from.id;
    areWeListening = false;
    switch (context.event.rawEvent.value.item) {
      case "comment":
        item = "comment";
        comment_id = context.event.rawEvent.value.comment_id;
        permalink = context.event.rawEvent.value.post.permalink_url;
        await MandatoAbertoAPI.postPrivateReply(item,page_id,post_id,comment_id,permalink,user_id);
        break;
      case "post":
        item = "post";
        await MandatoAbertoAPI.postPrivateReply(item,page_id,post_id,comment_id,permalink,user_id);
        break;
    }
  }
  // Tratando caso de o político não ter dados suficientes
  if (!context.state.dialog) {
    if (!context.state.politicianData.greetings && (!context.state.politicianData.contact && !context.state.pollData.questions)) {
      console.log("Politician does not have enough data");
      return false;
    }
    await context.resetState();
    await context.setState({ dialog: "greetings" });
  }

  // Tratando botão GET STARTED
  if (context.event.postback && context.event.postback.payload === "greetings") {
    await context.resetState();
    await context.setState({ politicianData: await MandatoAbertoAPI.getPoliticianData(context.event.rawEvent.recipient.id) });
    await context.setState({ dialog: "greetings" });
  }

  // Tratando dinâmica de issues
  if (context.state.dialog === "prompt") {
    if (context.event.isPostback) {
      await context.setState({ dialog: context.event.postback.payload });
    } else if (context.event.isQuickReply) {
      await context.setState({ dialog: context.event.message.quick_reply.payload });
    } else if (context.event.isText) {
      // Ao mandar uma mensagem que não é interpretada como fluxo do chatbot
      // Devo já criar uma issue
      // We go to the listening dialog to wait for other messages
      // check if message came from standard flow or from post/comment
      if (areWeListening === true) {
        await context.setState({ dialog: "prompt", dataPrompt: "email" });
        await context.setState({ dialog: "listening"});
      } else {
        await context.setState({ dialog: "intermediate" });
      }
    }
  }
  
  // Switch de dialogos
  if (context.event.isPostback && (context.state.dialog === "prompt" || context.event.postback.payload === "greetings")) {
    await context.setState({ dialog: context.event.postback.payload });
  } else if (context.event.isPostback && context.state.dialog === "listening" ) {
    await context.typingOff();
    const payload = context.event.postback.payload;
    await context.setState({ dialog: payload });
    if (context.event.message) {
      context.event.message.text = "";
    }
  }
  // quick_replies que vem de propagação que não são resposta de enquete
  // because of the issue response
  if (context.event.isQuickReply && (context.state.dialog !== "pollAnswer") && !(context.event.message.quick_reply.payload.includes("pollAnswerPropagate"))) { 
    await context.setState({ dialog: context.event.message.quick_reply.payload });
  }
    // Resposta de enquete
  if (context.event.isQuickReply && context.state.dialog === "pollAnswer") {
    poll_question_option_id = context.event.message.quick_reply.payload;
    await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id, "dialog");
  } else if (context.event.isQuickReply && context.event.message.quick_reply.payload && context.event.message.quick_reply.payload.includes("pollAnswerPropagate")) {
    // Tratando resposta da enquete através de propagação
    const payload = context.event.message.quick_reply.payload;
    poll_question_option_id = payload.substr(payload.indexOf("_") + 1, payload.length);
    await MandatoAbertoAPI.postPollAnswer(context.session.user.id, poll_question_option_id, "propagate");
    context.setState({ dialog: "pollAnswer" });
  } else if (context.event.isText && context.state.dialog === "pollAnswer") {
    await context.setState({ dialog: "listening" });
  }
  // Tratando dados adicionais do recipient
  if (context.state.dialog === "recipientData" && context.state.recipientData) {
    if (context.event.isQuickReply) { 
      if (context.state.dataPrompt === 'email') {
        await context.setState({ email: context.event.message.quick_reply.payload });
      } else if (context.state.dataPrompt === 'end') {
        await context.setState({ cellphone: context.event.message.quick_reply.payload });
      }
    } else if (context.event.isText) {
      if (context.state.dataPrompt === 'email') {
        await context.setState({ email: context.event.message.text })
      } else if (context.state.dataPrompt === 'end') {
        await context.setState({ cellphone: context.event.message.text })
      }
  }

    if (context.state.recipientData) {
      switch (context.state.recipientData) {
        case "email":
          await MandatoAbertoAPI.postRecipient(politicianData.user_id, {
            fb_id: context.session.user.id,
            email: context.state.email
          });
          await context.sendButtonTemplate("Legal, agora quer me informar seu telefone, para lhe manter informado sobre outras perguntas?", opt.recipientData_YesNo);
          await context.setState({ recipientData: "cellphonePrompt", dialog: "recipientData", dataPrompt: "" });
          break;
        case "cellphone":
          await context.setState({ cellphone: `+55${context.state.cellphone.replace(/[- .)(]/g, "")}`})
          if (phoneRegex.test(context.state.cellphone)) {
            await MandatoAbertoAPI.postRecipient(politicianData.user_id, {
              fb_id: context.session.user.id,
              cellphone: context.state.cellphone
            });
          } else {
            await context.setState({dataPrompt: "", recipientData: "cellphonePrompt"});
            await context.sendText("Desculpe-me, mas seu telefone não parece estar correto. Não esqueça de incluir o DDD. Por exemplo: 1199999-8888");
            await context.sendButtonTemplate("Vamos tentar de novo?", opt.recipientData_YesNo);
          }
          break;
        case "cellphonePrompt":
          await context.setState({ dialog: "recipientData", dataPrompt: "cellphone" });
          break;
      }
    }
  }

  switch (context.state.dialog) {
    case "greetings":
      await context.setState({ sendIntro: true });
      areWeListening = true;
      await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id)});
      await context.setState({ trajectory: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "trajectory") });
      await context.setState({ articles: getArticles(context.state.politicianData.gender) });
      await context.setState({ introduction: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "introduction") });
      await context.setState({ aboutMeText: await getAboutMe(context.state.politicianData) });
      await context.setState({ issueMessage: getIssueMessage(await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "issue_acknowledgment")) });
      await getMenuPrompt(context);
      await context.setState({ userMessage: "" }); // cleaning up
      await context.setState({ greeting: context.state.politicianData.greeting.replace("${user.office.name}", context.state.politicianData.office.name)});
      await context.setState({ greeting: context.state.greeting.replace("${user.name}", context.state.politicianData.name)});
      await context.sendText(context.state.greeting);
      // await context.sendButtonTemplate(context.state.issueMessage, promptOptions);
      await context.sendButtonTemplate(context.state.issueMessage, await checkMenu(context, [ opt.aboutPolitician, opt.poll_suaOpiniao, opt.doarOption ]));
      await context.setState({ dialog: "prompt" });
      break;
    case "mainMenu": // after issue is created we come back to this dialog
      await context.setState({ sendIntro: true });
      areWeListening = true;
      await context.setState({ pollData: await MandatoAbertoAPI.getPollData(context.event.rawEvent.recipient.id) });
      await context.setState({ trajectory: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "trajectory") });
      await context.setState({ articles: getArticles(context.state.politicianData.gender)});
      await context.setState({ introduction: await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "introduction") });
      await context.setState({ aboutMeText: await getAboutMe(context.state.politicianData) });
      // await context.setState({ issueMessage: getIssueMessage(await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "issue_acknowledgment")) });
      await getMenuPrompt(context);
      await context.setState({ userMessage: "" }); // cleaning up
      await context.sendButtonTemplate("Como posso te ajudar?", promptOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case "intermediate":
    // await context.setState({ userMessage: `${context.state.userMessage} + " "`});;
      await context.sendText(`Vocês gostaria de enviar uma mensagem para nossa equipe ou conhecer mais sobre ` + 
        `${context.state.articles.defined} ${context.state.politicianData.office.name} ${context.state.politicianData.name}?`);
      await context.sendButtonTemplate("Selecione a opção desejada em um dos botões abaixo:", [opt.writeMessage, opt.seeAssistent]);
      await context.setState({ dialog: "prompt" });
      break;
    case "votoLegal":
      await context.sendText("Estamos em pré-campanha e contamos com você.");
      await context.sendButtonTemplate("Quer fazer parte?", opt.votoLegal_participateOptions);
      await context.setState({ dialog: "prompt" });
      break;
    case 'knowMore': {
      await context.sendButtonTemplate('Existem diversas formas de participar da construção de uma candidatura. ' +
        'Posso ajudá-lo a realizar uma doação ou divulgar a pré-campanha. Quer entender melhor?', [opt.AboutDonation, opt.AboutDivulgation, opt.goBackMainMenu]);
      await context.setState({ dialog: "prompt" });
      break; }
    case "aboutDonation":
      await context.sendText('Doar é importante para campanhas mais justas.');
      await context.sendText('Aqui no site, você pode doar por meio do cartão de crédito ou boleto bancário.');
      await context.sendButtonTemplate('Com o pagamento aprovado, enviaremos um recibo provisório por e-mail. Cada pessoa pode doar até 10% da renda declarada ' +
        'referente ao ano anterior. O limite de doação diária é de R$ 1.064,10.', [opt.wannaDonate, opt.backToKnowMore]);
      await context.setState({ dialog: "prompt" });
      break;
    case "aboutDivulgation":
      await context.setState({
        participateOptions: [
          {
            type: "postback",
            title: "Deixar Contato",
            payload: "recipientData"
          },
        ]});
      if (context.state.politicianData.picframe_url) {
        await context.setState({
          participateOptions: context.state.participateOptions.concat([{
            type: "web_url",
            url: context.state.politicianData.picframe_url,
            title: "Mudar Avatar"
          }])});
      }
      await context.setState({ participateOptions: context.state.participateOptions.concat([opt.backToKnowMore])});
      await context.sendButtonTemplate('Para ajudar na divulgação, você pode deixar seus contatos comigo ou mudar sua imagem de avatar. Você quer participar?',
        context.state.participateOptions);
      await context.setState({ dialog: "prompt", dataPrompt: "email" });
    break;
    case "WannaHelp":
      await context.setState({ participateOptions: [opt.wannaDonate]});
      // checking for picframe_url so we can only show this option when it's available but still show the votoLegal option
      if (context.state.politicianData.picframe_url) {
        await context.setState({ participateOptions: context.state.participateOptions.concat([opt.wannaDivulgate]) });
      }
      await context.setState({ participateOptions: context.state.participateOptions.concat([opt.goBackMainMenu]) });
      await context.sendButtonTemplate("Ficamos felizes com seu apoio! Como deseja participar?", context.state.participateOptions);
      await context.setState({ dialog: "prompt", participateOptions: undefined });
      break;
    case "WannaDonate":
     // if referral.source(CUSTOMER_CHAT_PLUGIN) doesn't exist we are on facebook and should send votolegal's url
      if (!context.event.rawEvent.postback.referral) {

        await context.setState({ participateOptions: [
          {
            type: "web_url",
            url: `${context.state.politicianData.votolegal_integration.votolegal_url}/#doar`,
            title: "Vamos lá!"
          }], participateMessage: "Você deseja doar agora?"});
      }
      else {
        await context.setState({ participateOptions: [], participateMessage: "Você já está na nossa página para doar. Se quiser, também poderá divulgar seu apoio!"});
      }
      // checking for picframe_url so we can only show this option when it's available but still show the votoLegal option
      if (context.state.politicianData.picframe_url) {
        // await participateOptions.push(opt.wannaDivulgate);
        await context.setState({ participateOptions: context.state.participateOptions.concat([opt.wannaDivulgate]) });
      }
      await context.setState({ participateOptions: context.state.participateOptions.concat([opt.goBackMainMenu]) });
      // await participateOptions.push(opt.goBackMainMenu);
      await context.sendText("Seu apoio é fundamental para nossa pré-campanha! Por isso, cuidamos da segurança de todos os doadores. " + 
      "Saiba mais em: www.votolegal.com.br");
      await context.setState({ valueLegal: await VotoLegalAPI.getVotoLegalValues(context.state.politicianData.votolegal_integration.votolegal_username) });
      await context.sendText(`Já consegui R$${formatReal(context.state.valueLegal.candidate.total_donated)} da minha meta de ` +
      `R$${formatReal(getMoney(context.state.valueLegal.candidate.raising_goal))}.`);
      await context.sendButtonTemplate(context.state.participateMessage, context.state.participateOptions);
      await context.setState({ dialog: "prompt", valueLegal: undefined, participateOptions: undefined, participateMessage: undefined});
      break;
    case "WannaDivulgate":
      await context.sendButtonTemplate("Que legal! Seu apoio é muito importante para nós! Você quer mudar foto (avatar) do seu perfil?", [
        {
          type: "web_url",
          url: context.state.politicianData.picframe_url,
          title: "Atualizar foto"
        },
        opt.wannaDonate,
        opt.goBackMainMenu
      ]);
      await context.setState({ dialog: "prompt" });
      break;
    case "listening":
      // When user enters with text, prompt sends us here
      // if it's the first message we warn the user that we are listening and wait for 60s for a new message
      // we keep adding new messages on top of each other until user stops for 60s, then we can save the issue and go back to the menu
      if (context.state.sendIntro === true) {
        await context.sendText("Vejo que você está escrevendo. Seu contato é muito importante. Quando terminar, entrego sua mensagem para nossa equipe.");
        await context.setState({sendIntro: false});
      }
      await context.typingOn();
      clearTimeout(timer);
      if (context.event.message) {
        await context.setState({ userMessage: `${context.state.userMessage}${context.event.message.text} `});
      }
      timer = setTimeout(async () => {
        await context.setState({ sendIntro: true });    
        const issue_created_message = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "issue_created");
        let endMessage;
        if (issue_created_message.content) {
          endMessage = issue_created_message.content + "\nVocê terminou de escrever sua mensagem?";
        } else {
          endMessage = "Você terminou de escrever sua mensagem?";
        }
        await context.sendButtonTemplate(endMessage, [
            {
              type: "postback",
              title: "Terminei a mensagem",
              payload: "listeningAnswer"
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
      const introductionText = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "introduction");
      await context.sendText(introductionText.content);
      await context.sendButtonTemplate(`O que mais deseja saber sobre ${context.state.articles.defined} ${context.state.politicianData.office.name}?`, 
        await checkMenu(context, [opt.trajectory, opt.contacts, opt.doarOption]));
      await context.setState({ dialog: "prompt" });
      break;
    case "contacts":
      // Tratando o formato do telefone
      if (context.state.politicianData.contact.cellphone) {
        await context.setState({ politicianCellPhone: context.state.politicianData.contact.cellphone.replace(/(?:\+55)+/g, "")})
        await context.setState({ politicianCellPhone: context.state.politicianCellPhone.replace(/^(\d{2})/g, "($1)")})
      }
      await context.sendText(`Você pode entrar em contato com ${context.state.articles.defined} ${context.state.politicianData.office.name} `+
      `${context.state.politicianData.name} pelos seguintes canais:`);
      if (context.state.politicianData.contact.email) {
        await context.sendText(` - Através do e-mail: ${context.state.politicianData.contact.email}`);
      }
      if (context.state.politicianData.contact.cellphone) {
        await context.sendText(` - Através do WhatsApp: ${context.state.politicianCellPhone}`);
      }
      if (context.state.politicianData.contact.twitter) {
        await context.sendText(` - Através do Twitter: ${context.state.politicianData.contact.twitter}`);
      }
      if (context.state.politicianData.contact.url) {
        await context.sendText(` - Através do site: ${context.state.politicianData.contact.url}`);
      }
      await context.sendButtonTemplate("Quer saber mais?", await checkMenu(context, [opt.trajectory, opt.poll_suaOpiniao, opt.doarOption]));
      await context.setState({ dialog: "prompt", politicianCellPhone: undefined});
      break;
    case "poll":
      const recipientAnswer = await MandatoAbertoAPI.getPollAnswer(context.session.user.id, context.state.pollData.id);
      if (recipientAnswer.recipient_answered >= 1) {
        await context.sendText("Ah, que pena! Você já respondeu essa pergunta.");
        await context.sendButtonTemplate("Se quiser, eu posso te ajudar com outra coisa.", 
          await checkMenu(context, [opt.trajectory, opt.contacts, opt.doarOption]));
        await context.setState({ dialog: "prompt" });
      } else {
        await context.sendText("Quero conhecer você melhor. Deixe sua resposta e participe deste debate.");
        await context.sendText(`Pergunta: ${context.state.pollData.questions[0].content}` , {
          quick_replies: [
            {
              content_type: 'text',
              title: context.state.pollData.questions[0].options[0].content,
              payload: `${context.state.pollData.questions[0].options[0].id}`
            },
            {
              content_type: 'text',
              title: context.state.pollData.questions[0].options[1].content,
              payload: `${context.state.pollData.questions[0].options[1].id}`
            },
          ]});
        await context.typingOff();
        await context.setState({ dialog: "pollAnswer" });
      }
      break;
      case 'listeningAnswer':
      await MandatoAbertoAPI.postIssue(context.state.politicianData.user_id,context.session.user.id, context.state.userMessage);
      await context.setState({ userMessage: '' });
      await context.sendButtonTemplate('Agradecemos a sua mensagem. Deseja nos enviar ou atualizar seu e-mail e telefone?', opt.recipientData_LetsGo);
      await context.setState({ dialog: "prompt", dataPrompt: "email" });
      break;   
      case "pollAnswer":
      await context.sendButtonTemplate("Muito obrigado por sua resposta. Você gostaria de deixar seu e-mail e telefone para nossa equipe?", opt.recipientData_LetsGo);
      await context.setState({ dialog: "prompt", dataPrompt: "email" });
      break;
    case "recipientData":
    if (context.event.postback && (context.event.postback.title === "Agora não" || context.event.postback.title === "Não")) {
        await context.sendButtonTemplate("Está bem! Posso te ajudar com mais alguma informação?", promptOptions);
        await context.setState({ dialog: "prompt" });
      } else if (context.state.dataPrompt) {
        switch (context.state.dataPrompt) {
          case "email":
          try {
            await context.sendText("Qual o seu e-mail? Pode digita-lo e nos mandar.", {
              quick_replies: [
                {
                  content_type: 'user_email',
                },
              ],
            });
          } catch(err) {
            console.log('E-mail button catch error =>', err)
            await context.sendText("Qual é o seu e-mail?");
          } finally {
              await context.setState({ dialog: "recipientData", recipientData: "email"});
          }
            break;
          case "cellphone":
          try {
            await context.sendText("Qual é o seu telefone? Não deixe de incluir o DDD.", {
              quick_replies: [
                {
                  content_type: 'user_phone_number',
                },
              ],
            });
          } catch(err) {
            console.log('Cellphone button catch error =>', err)
            await context.sendText("Qual é o seu telefone? Não deixe de incluir o DDD.");
          } finally {
            await context.setState({ dialog: "recipientData", recipientData: "cellphone", dataPrompt: "end"});
          }
            break;
          case "cellphoneFail":
            break;
          case "end":
          await context.sendText("Pronto, já guardei seus dados.");
          await context.sendButtonTemplate("Quer saber mais?", promptOptions);
          await context.setState({ dialog: "prompt", recipientData: undefined, dataPrompt: undefined });
            break;
        }
      }
      break;
    case "trajectory":
      await context.sendText(context.state.trajectory.content);
      await context.sendButtonTemplate("Quer saber mais?", await checkMenu(context, [opt.poll_suaOpiniao, opt.contacts, opt.doarOption]));
      await context.setState({ dialog: "prompt" });
      break;
    case "issue":
      await context.sendText("Escreva sua mensagem para nossa equipe:");
      await context.setState({ dialog: "prompt", prompt: "issue" });
      break;
    case "issue_created":
      const issue_created_message = await MandatoAbertoAPI.getAnswer(context.state.politicianData.user_id, "issue_created");
      await context.sendButtonTemplate(issue_created_message.content, [ opt.backToBeginning ]);
      await context.setState({ dialog: "prompt" });
      break;
  }
});

const server = createServer(bot, { verifyToken: config.verifyToken });

server.listen(process.env.API_PORT, () => {
  console.log(`Server is running on ${process.env.API_PORT} port...`);
});
