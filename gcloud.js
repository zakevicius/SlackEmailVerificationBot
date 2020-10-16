const axios = require("axios");

exports.app = (req, res) => {
  if (req.body.challenge) return res.status(200).send(req.body.challenge);

  if (req.body.command) {
    res.status(200).send(`I'll get back to you later with results`);
    handleCommand(req.body);
    console.log("---------------------COMMAND-------------------------");
    console.log(req.body);
    console.log("-----------------------END---------------------------");
    return;
  }

  res.sendStatus(200);

  if (req.body.event) {
    const eventData = req.body.event;
    const { bot_id, type, text, channel, ...rest } = eventData;
    if (eventData && !bot_id) {
      console.log("----------------------EVENT--------------------------");
      console.log(req.body);
      console.log("-----------------------END---------------------------");
      handleEvent(type, text, channel);
    }
  }
};

function handleEvent(type, text, channel) {
  switch (type) {
    case "app_mention":
      handleAppMentionEvent(text, channel);
    case "message":
      handleMessageEvent(text, channel);
      break;
    default:
      break;
  }
}

function handleCommand(data) {
  const {
    command,
    text,
    channel_id: channel,
    user_id: user,
    response_url
  } = data;

  switch (command) {
    case "/mailo":
      replyWithVerificationResults(text, channel, response_url);
      break;
    default:
      break;
  }
}

async function handleAppMentionEvent(text, channel) {
  let splittedText = text.split(" ");
  const email = extractEmail(splittedText[1]);
  replyWithVerificationResults(email, channel);
}

async function handleMessageEvent(text, channel) {
  let splittedText = text.split(" ");
  if (splittedText[0] === "!verify") {
    const email = extractEmail(splittedText[1]);
    replyWithVerificationResults(email, channel);
  }
}

const postMessageUrl = "https://slack.com/api/chat.postMessage";

const postMessageConfig = {
  method: "post",
  url: postMessageUrl,
  headers: {
    "Content-type": "application/json",
    Authorization: `Bearer ${process.env.BOT_TOKEN}`
  }
};

function replyToChannel(reply, channel) {
  axios({
    ...postMessageConfig,
    data: {
      channel,
      ...reply
    }
  });
}

function replyToUrl(reply, url) {
  axios({
    ...postMessageConfig,
    url,
    data: {
      ...reply
    }
  });
}

function extractEmail(text) {
  if (!text) return text;
  return (
    text.slice(text.indexOf("mailto:") + "mailto:".length, text.indexOf("|")) ||
    text
  );
}

function verifyEmailLocally(email) {
  return email.match(/^\S+@\S+\.\S+$/);
}

async function replyWithVerificationResults(email, channel, response_url) {
  const reply = response_url ? replyToUrl : replyToChannel;
  const to = response_url ? response_url : channel;
  if (!email) return reply({ text: "Provide an email to verify" }, to);
  if (verifyEmailLocally(email)) {
    let response = await initVerification(email);
    return reply(makeResponseBeautiful(email, response), to);
  } else {
    return reply({ text: `Incorrect e-mail format.` }, to);
  }
}

async function initVerification(email) {
  let responses = [];
  while (responses.length < 10) {
    responses.push(verifyEmail(email));
  }
  return Promise.all(responses).then((values) => {
    let results = values.map((val) => val.result);
    return results;
  });
}

async function verifyEmail(email) {
  try {
    let response = await axios.get(
      `http://api.quickemailverification.com/v1/verify?email=${email}&apikey=${process.env.API_KEY}`
    );
    return response.data;
  } catch (err) {
    console.log(err.response.status);
    return {
      result: err.response.statusText
    };
  }
}

function makeResponseBeautiful(email, response) {
  let valid = 0;
  let invalid = 0;
  for (r of response) {
    if (r === "valid") {
      valid++;
    } else {
      invalid++;
    }
  }

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Results for \`${email}\`: \n\n *Valid: \`${valid}\` Invalid: \`${invalid}\`*`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `All checks: [${response.join(", ")}]`
        }
      }
    ]
  };
}
