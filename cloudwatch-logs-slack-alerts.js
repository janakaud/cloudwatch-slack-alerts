const AWS = require("aws-sdk");
const logs = new AWS.CloudWatchLogs();


const env = key => {
	let val = process.env[key];
	if (!val) {
		throw new Error(`${key} unconfigured`);
	}
	return val;
};


const period = parseInt(env("POLL_PERIOD_MS"));
if (!period) {
	throw new Error(`Invalid poll period ${period}`);
}
const groups = env("LOG_GROUPS").split(" ");
const filterPattern = env("LOG_PATTERN");
const hook = env("SLACK_WEBHOOK_URL");
const channel = env("SLACK_CHANNEL");
const username = env("SLACK_USER");
const icon_emoji = env("SLACK_ICON");


const axios = require("axios");

const postMsg = text => {
	return axios.post(hook, {
		channel, username, icon_emoji,
		text
	});
};


exports.handler = async event => {
	const startTime = Date.now() - period;

	let timeStr = new Date(startTime).toTimeString();
	timeStr = timeStr.substring(0, timeStr.indexOf(" "));
	console.log(timeStr);

    let checks = groups.map(async g => {
		// if not namespaced, add default Lambda prefix
		let logGroupName = g.indexOf("/") < 0 ? `/aws/lambda/${g}` : g;

		let msg, partial = true;
		try {
			let data = await logs.filterLogEvents({
				logGroupName,
				filterPattern,
				startTime,
				limit: 100
			}).promise();
			msg = data.events.map(e => e.message.substring(0, 400).trim()).join("\n\n").substring(0, 4000);
			partial = !!data.nextToken || msg.length === 4000;
		} catch (e) {
			msg = `Failed to poll ${g}; ${e.message}`;
		}
		return msg.length > 0 ? `\`${g}${partial ? " [partial]" : ""}\`

\`\`\`
${msg}
\`\`\`` : null;
	});

	// post gathered logs as one Slack msg
    return await Promise.all(checks)
		.then(msgs => {
			let valid = msgs.filter(m => !!m);
			if (valid.length > 0) {
				postMsg(`*${timeStr}*

${valid.join("\n\n")}`);
			}
		})
		.catch(e => postMsg(`*FAULT* ${timeStr}

\`\`\`
${e.message}
\`\`\``));
};
