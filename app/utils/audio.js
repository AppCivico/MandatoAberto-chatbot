const dialogflow = require('dialogflow');
const request = require('requisition');
const fs = require('fs');
const util = require('util');
const exec = require('child_process').exec;

const projectId = process.env.PROJECT_ID;

// Ops: dialogflow needs a GOOGLE_APPLICATION_CREDENTIALS env with the path to the json key
// Instantiates a sessison client
const sessionClient = new dialogflow.SessionsClient();

const queryInput = {
	audioConfig: {
		audioEncoding: 'flac',
		sampleRateHertz: 44100,
		languageCode: 'pt-br',
	},
};

async function voiceRequest(urlMessenger, sessionID) {
	// The path to identify the agent that owns the created intent
	const sessionPath = sessionClient.sessionPath(projectId, sessionID);

	const fileIn = `${sessionID}.mp4`;
	const fileOut = `${sessionID}.flac`;

	// if any of the two files alreay existes, delete them (just to be safe)
	if (await fs.existsSync(fileIn)) { await fs.unlinkSync(fileIn); }
	if (await fs.existsSync(fileOut)) { await fs.unlinkSync(fileOut); }

	const file = fs.createWriteStream(fileIn);

	// downloading file from messenger URL and saving it to a mp4 file
	const answer = await request(urlMessenger);
	answer.pipe(file);

	// converting the mp4 file to a mono channel flac
	const dir = await exec(`ffmpeg -i ${fileIn} -ac 1 ${fileOut}`, (err) => {
		if (err) { console.log(err); }
	});

	await dir.on('exit', (code) => {
		if (code === 0) { // mp4 converted successfully
			// Read the content of the audio file and send it as part of the request
			const readFile = util.promisify(fs.readFile, { singular: true });
			readFile(`${fileOut}`)
				.then((inputAudio) => {
					// The audio query request
					const requestOptions = {
						session: sessionPath,
						queryInput,
						inputAudio,
					};
					// Recognizes the speech in the audio and detects its intent
					return sessionClient.detectIntent(requestOptions);
				}).then((responses) => {
					console.log('Detected intent =>');
					console.log(responses[0].queryResult);
					// recognized text responses[0].queryResult.queryText
				}).catch((err) => {
					console.error('ERROR:', err);
				})
				.finally(async () => {
					await fs.unlinkSync(fileOut);
					await fs.unlinkSync(fileIn);
				});
		} else {
			console.log('Não foi possível converter os arquivos');
		}
	});
}

module.exports.voiceRequest = voiceRequest;
