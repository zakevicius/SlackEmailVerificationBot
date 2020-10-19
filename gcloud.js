const axios = require("axios");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

const client = new SecretManagerServiceClient();
let quick_email_api_key, slack_access_token;

async function accessSecretVersion() {
  const [version] = await client.accessSecretVersion({
    name: process.env.SECRET_RESOURCE_ID,
  });
  data = JSON.parse(version.payload.data);
  quick_email_api_key = data.quick_email_api_key;
  slack_access_token = data.slack_access_token;
}

exports.mailo = async (req, res) => {
  await accessSecretVersion();

  if (req.body.challenge) return res.status(200).send(req.body.challenge);

  if (req.body.command) {
    res.status(200).send(`I'll get back to you later with results`);
    handleCommand(req.body);
    return;
  }

  res.sendStatus(200);

  if (req.body.event) {
    const eventData = req.body.event;
    const { bot_id, type, text, channel, ...rest } = eventData;
    if (eventData && !bot_id) {
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
    response_url,
  } = data;

  switch (command) {
    case "/mailo":
      splittedText = text.split(/\s+/);
      splittedText[0] == "" && splittedText.shift();
      extractAndReply(splittedText, channel, false, response_url);
      break;
    default:
      break;
  }
}

async function handleAppMentionEvent(text, channel) {
  let splittedText = text.split(/\s+/);
  splittedText.shift();
  extractAndReply(splittedText, channel);
}

async function handleMessageEvent(text, channel) {
  let splittedText = text.split(/\s+/);
  if (splittedText[0] === "!mailo") {
    splittedText.shift();
    extractAndReply(splittedText, channel);
  }
}

async function extractAndReply(
  emails,
  channel,
  extract = true,
  response_url = ""
) {
  const dataForReply = [];
  if (emails.length == 0) {
    dataForReply.push({
      error: {
        message: "Provide an email to verify",
      },
    });
  } else {
    for (let email of emails) {
      const extractedEmail = extract ? extractEmail(email) : email;
      dataForReply.push(await getVerificationResults(extractedEmail));
    }
  }
  reply(dataForReply, channel, response_url);
}

function getPostMessageConfig() {
  const postMessageUrl = "https://slack.com/api/chat.postMessage";
  return {
    method: "post",
    url: postMessageUrl,
    headers: {
      "Content-type": "application/json",
      Authorization: `Bearer ${slack_access_token}`,
    },
  };
}

function replyToChannel(reply, channel) {
  axios({
    ...getPostMessageConfig(),
    data: {
      channel,
      ...reply,
    },
  });
}

function replyToUrl(reply, url) {
  axios({
    ...getPostMessageConfig(),
    url,
    data: {
      ...reply,
    },
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

async function getVerificationResults(email) {
  if (verifyEmailLocally(email)) {
    let responses = await initVerification(email);
    return categorizeResponse(responses);
  } else {
    return {
      email: email,
      error: {
        message: "Invalid e-mail format.",
      },
    };
  }
}

function reply(data, channel, response_url) {
  const reply = response_url ? replyToUrl : replyToChannel;
  const to = response_url ? response_url : channel;
  reply(makeResponseBeautiful(data), to);
}

async function initVerification(email) {
  let responses = [];
  while (responses.length < 10) {
    responses.push(verifyEmail(email));
  }
  return Promise.all(responses).then((values) => {
    return values;
  });
}

async function verifyEmail(email) {
  try {
    let response = await axios.get(
      `http://api.quickemailverification.com/v1/verify?email=${email}&apikey=${quick_email_api_key}`
    );
    return response.data;
  } catch (err) {
    console.log(err.response);
    return {
      error: {
        status: err.response.status,
        message: err.response.statusText,
      },
    };
  }
}

function categorizeResponse(responses) {
  let categorized = {};
  for (let item of responses) {
    if (item.error !== undefined) {
      categorized.error = item.error;
      continue;
    }
    for (let key in item) {
      if (categorized[item.email] !== undefined) {
        if (categorized[item.email][key] !== undefined) {
          if (categorized[item.email][key][item[key]] !== undefined) {
            categorized[item.email][key][item[key]] += 1;
          } else {
            categorized[item.email][key][item[key]] = 1;
          }
        } else {
          categorized[item.email][key] = {};
          categorized[item.email][key][item[key]] = 1;
        }
      } else {
        categorized[item.email] = {};
        categorized[item.email][key] = {};
        categorized[item.email][key][item[key]] = 1;
      }
    }
  }
  return categorized;
}

function makeResponseBeautiful(responses) {
  let invalidKeys = ["reason"];
  let validKeys = ["safe_to_send", "accept_all"];
  let textsArray = [];

  for (let response of responses) {
    let text = "";
    if (response.error) {
      if (response.email !== undefined) {
        text += `Results for \`${response.email}\` \n\n`;
      }
      text += `\`Error:\` ${response.error.message} \n\n`;
      textsArray.push(text);
      continue;
    }

    let email = Object.keys(response)[0];
    let emailData = response[email];
    let containsInvalid = false;

    text += `Email: \`${email}\` \n`;

    if (Object.keys(emailData.result).includes("valid")) {
      text += `\`Valid:\` ${emailData.result.valid} ${validOrInvalidText(
        "valid"
      )}`;
    }

    for (let key in emailData.result) {
      if (key === "valid") continue;
      containsInvalid = true;
      text += `\`${key}\`: ${emailData.result[key]}, `;
    }
    text += `${validOrInvalidText("invalid")}`;

    textsArray.push(text);

    function validOrInvalidText(type) {
      let keysArray = type === "valid" ? validKeys : invalidKeys;
      let tempText = "";

      for (let key in emailData) {
        if (!containsInvalid && key === "reason") continue;
        if (keysArray.includes(key) && emailData[key] !== undefined) {
          for (let subkey in emailData[key]) {
            switch (type) {
              case "valid":
                if (subkey == "true") {
                  tempText += `\`${key}:\` ${emailData[key][subkey]}, `;
                } else if (subkey == "false") {
                  break;
                } else {
                  tempText += `\`${key}:\` ${subkey}: ${emailData[key][subkey]}, `;
                }
                break;
              default:
                if (
                  emailData[key][subkey] !== undefined &&
                  subkey !== "accepted_email"
                ) {
                  tempText += `\`${subkey}:\` ${emailData[key][subkey]}, `;
                }
            }
          }
        }
      }
      return `${tempText}\n`;
    }
  }

  blocks = [];

  textsArray.forEach((text) => {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: text,
        },
      },
      {
        type: "divider",
      }
    );
  });

  return {
    blocks: blocks,
  };
}
