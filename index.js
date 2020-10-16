require('dotenv').config();
const axios = require('axios');
const express = require('express');
const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.urlencoded());

app.get('/', (req, res) => {
	res.sendStatus(200);
});

app.post('/', (req, res) => {
	if (req.body.challenge) {
		return res.status(200).send(req.body.challenge);
	}

	if (req.body.command) {
		res.status(200).send(`I'll get back to you later with results`);
		handleCommand(req.body);
		// console.log("---------------------COMMAND-------------------------");
		// console.log(req.body);
		// console.log("-----------------------END---------------------------");
		return;
	}
	res.sendStatus(200);

	//   console.log(
	//     "-------------------------POST REQUEST START-------------------------"
	//   );
	//   if (req.body.command || (req.body.event && !req.body.bot_id)) {
	//     console.log(req.body);
	//     console.log(req.headers);
	//   }
	//   console.log(
	//     "----------------------------REQUEST END-----------------------------"
	//   );

	if (req.body.event) {
		const eventData = req.body.event;
		const { bot_id, type, text, channel } = eventData;
		if (eventData && !bot_id) {
			handleEvent(type, text, channel);
		}
	}
});

function handleEvent(type, text, channel) {
	switch (type) {
		case 'app_mention':
			handleAppMentionEvent(text, channel);
		case 'message':
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
		case '/mailo':
			splittedText = text.split(/\s+/);
			splittedText[0] == '' && splittedText.shift();
			extractAndReply(splittedText, channel, false, response_url);
			break;
		default:
			break;
	}
}

async function handleAppMentionEvent(text, channel) {
	console.log(text);
	let splittedText = text.split(/\s+/);
	splittedText.shift();
	extractAndReply(splittedText, channel);
}

async function handleMessageEvent(text, channel) {
	let splittedText = text.split(/\s+/);
	if (splittedText[0] === '!verify') {
		splittedText.shift();
		extractAndReply(splittedText, channel);
	}
}

async function extractAndReply(
	emails,
	channel,
	extract = true,
	response_url = ''
) {
	console.log(emails);
	const dataForReply = [];
	if (emails.length == 0) {
		dataForReply.push({
			error: {
				message: 'Provide an email to verify'
			}
		});
	} else {
		for (let email of emails) {
			const extractedEmail = extract ? extractEmail(email) : email;
			dataForReply.push(await getVerificationResults(extractedEmail));
		}
	}
	reply(dataForReply, channel, response_url);
}

const postMessageUrl = 'https://slack.com/api/chat.postMessage';

const postMessageConfig = {
	method: 'post',
	url: postMessageUrl,
	headers: {
		'Content-type': 'application/json',
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
		text.slice(text.indexOf('mailto:') + 'mailto:'.length, text.indexOf('|')) ||
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
				message: 'Invalid e-mail format.'
			}
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
			`http://api.quickemailverification.com/v1/verify/sandbox?email=${email}&apikey=${process.env.API_KEY}`
		);
		return response.data;
	} catch (err) {
		console.log(err.response);
		return {
			error: {
				status: err.response.status,
				message: err.response.statusText
			}
		};
	}
}

function categorizeResponse(response) {
	let categorized = {};
	for (let item of response) {
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
	console.log(responses);
	let text = '';
	let fields = ['result', 'safe_to_send', 'accept_all'];

	for (let response of responses) {
		if (response.error) {
			if (response.email !== undefined) {
				text += `Results for \`${response.email}\` \n\n`;
			}
			text += `${response.error.message} \n\n`;
			continue;
		}
		let email = Object.keys(response)[0];
		text += `Results for \`${email}\` \n\n`;
		for (let key in response[email]) {
			if (fields.includes(key) && response[email][key] !== undefined) {
				text += `\`${key}\`: `;
				for (let subkey in response[email][key]) {
					if (response[email][key][subkey] !== undefined) {
						text += `${subkey}: ${response[email][key][subkey]}, `;
					}
				}
			}
		}
		text += '\n\n';
	}

	return {
		blocks: [
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: text
				}
			},
			{
				type: 'divider'
			}
		]
	};
}

app.listen(PORT, () => console.log('App is listening'));
