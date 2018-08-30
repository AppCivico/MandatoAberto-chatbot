require('dotenv').config();


const dialogflow = require('dialogflow');
const request = require('requisition');
const fs = require('fs');
const exec = require('child_process').exec; // eslint-disable-line 
const getDuration = require('get-audio-duration');

const util = require('util');
require('util.promisify').shim();

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
async function checkAndDelete(name) {
	if (await fs.existsSync(name) === true) {
		// await fs.closeSync(name);
		await fs.unlinkSync(name, (err) => {
			console.log(err);
		});
	}
}

async function voiceRequest(urlMessenger, sessionID, context) {
	// The path to identify the agent that owns the created intent
	const sessionPath = sessionClient.sessionPath(projectId, sessionID);

	const fileIn = `${sessionID}.mp3`;
	const fileOut = `${sessionID}.wav`;

	// if any of the two files alreay existes, delete them (just to be safe)
	await checkAndDelete(fileIn);
	await checkAndDelete(fileOut);

	// downloading file from messenger URL and saving it to a mp4 file
	const file = fs.createWriteStream(fileIn, { flags: 'a' });
	const answer = await request(urlMessenger);
	await answer.pipe(file);

	// checking audio duration, it can't be bigger than 60s
	await getDuration(fileIn).then(async (duration) => {
		if (duration < 60) {
			// await fixDotPart(fileIn);
			// converting the mp4 file to a mono channel flac
			const dir = await exec(`ffmpeg -i ${fileIn} -ac 1 ${fileOut} -y `, async (err) => {
				if (err) {
					await checkAndDelete(fileIn);
					await checkAndDelete(fileOut);
					console.log(err);
				}
			});

			await dir.on('exit', async (code) => { // eslint-disable-line 
				// console.log(`\nCode${code}\n`);
				await checkAndDelete(fileIn);

				if (code === 0) { // mp4 converted successfully
					// Read the content of the audio file and send it as part of the request
					const readFile = await util.promisify(fs.readFile, { singular: true });
					await readFile(`${fileOut}`)
						.then((inputAudio) => {
							// The audio query request
							const requestOptions = {
								session: sessionPath,
								queryInput,
								inputAudio,
							};
							// Recognizes the speech in the audio and detects its intent
							return sessionClient.detectIntent(requestOptions);
						}).then(async (responses) => {
							console.log('Detected intent =>');
							console.log(responses);

							await checkAndDelete(fileIn);
							await checkAndDelete(fileOut);

							const detected = responses[0].queryResult;
							if (detected) {
								console.log('What was said:', detected.queryText);
								console.log('Parameters:', detected.parameters.fields);
								// console.log('ListValue:', Object.keys(detected.parameters.fields));

								Object.keys(detected.parameters.fields).forEach((element) => {
									if (detected.parameters.fields[element].listValue && detected.parameters.fields[element].listValue.values.length !== 0) {
										console.log('element', element); // only this element is a detected intent/theme
										// console.log(JSON.stringify(detected.parameters.fields[element].listValue.values));
									}
								});

								// await context.sendText(`Você disse "${detected.queryText}"`);
								if (detected.parameters === null || Object.keys(detected.parameters).length === 0 || Object.keys(detected.parameters.fields).length === 0) {
									await context.sendText('Politico ainda não se posicionou sobre esse tema');
									// manda o detected.queryText pra issue
								} else {
									await context.sendText('Os temas são tal e tal?');
									console.log(JSON.stringify(detected.parameters));
								}
							} else {
								await context.sendText('Não entendi o que você disse');
							}
							// recognized text responses[0].queryResult.queryText
						}).catch(async (err) => {
							console.error('ERROR:', err);
							await context.sendText('Não entendi o que você disse');
							await checkAndDelete(fileIn);
							await checkAndDelete(fileOut);
							return undefined;
						});
				} else {
					console.log('Não foi possível converter os arquivos');
					await context.sendText('Não entendi o que você disse');
					await checkAndDelete(fileIn);
					await checkAndDelete(fileOut);
					return undefined;
				}
				// await context.sendText('Não entendi o que você disse');
				// return response;
			});
		} else {
			await context.sendText('Áudio muito longo! Tem que ter menos de 1 minuto!');
			await checkAndDelete(fileIn);
			await checkAndDelete(fileOut);
		}
	});
}

module.exports.voiceRequest = voiceRequest;

const url = `
https://cdn.fbsbx.com/v/t59.3654-21/39962059_1855136381260716_969037238652370944_n.mp4/audioclip-1535383065000-2879.mp4?_nc_cat=0&oh=74f235bf4babd6545fd91cd6737e7da4&oe=5B870862
`;
voiceRequest(url, '123123');
