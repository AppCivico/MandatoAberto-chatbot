
require('dotenv').config();

const dialogflow = require('dialogflow');
const request = require('requisition');
const fs = require('fs');
const exec = require('child_process').exec; // eslint-disable-line 
const getDuration = require('get-audio-duration');
const fse = require('fs-extra');

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
	if (await fse.pathExists(name) === true) {
		// await fs.closeSync(name);
		await fse.remove(name, (err) => {
			if (err) {
				console.log(`Couldn't delete file ${name} => `, err);
			}
		});
	}
}

async function voiceRequest(urlMessenger, sessionID, testeAudio) {
	// The path to identify the agent that owns the created intent
	const sessionPath = sessionClient.sessionPath(projectId, sessionID);

	const fileIn = `${sessionID}.mp4`;
	const fileOut = `${sessionID}.flac`;

	// if any of the two files alreay existes, delete them (just to be safe)
	await checkAndDelete(fileIn);
	await checkAndDelete(fileOut);

	// downloading file from messenger URL and saving it to a mp4 file
	const file = fs.createWriteStream(fileIn, { flags: 'a' });
	const answer = await request(urlMessenger);
	await answer.pipe(file);

	file.on('finish', async () => {
		// converting the mp4 file to a mono channel flac (we have to convert before checking for duration because of 'moov atom' issues)
		const dir = await exec(`ffmpeg -i ${fileIn} -ac 1 -movflags +faststart ${fileOut} -y`, async (err) => {
			if (err) {
				await checkAndDelete(fileIn);
				await checkAndDelete(fileOut);
				console.log('Error at conversion => ', err);
			}
		});

		await dir.on('exit', async (code) => { // eslint-disable-line 
			if (code === 0) { // mp4 converted to flac successfully
				// checking flac duration, it can't be bigger than 60s
				await getDuration(fileOut).then(async (duration) => {
					console.log(duration);

					if (duration < 60) {
						// Read the content of the audio file and send it as part of the request
						const readFile = await util.promisify(fs.readFile, { singular: true });
						const result = await readFile(`${fileOut}`)
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
								// console.log('Detected intent => ', responses);

								await checkAndDelete(fileIn);
								await checkAndDelete(fileOut);

								const detected = responses[0].queryResult;
								if (detected && detected.queryText !== '') { // if there's no text we simlpy didn't get what the user said
									// format parameters the same way dialogFlow does with text
									console.log(detected);

									const parameters = [];
									for (const element of Object.keys(detected.parameters.fields)) { // eslint-disable-line no-restricted-syntax
										// removes empty parameters
										if (detected.parameters.fields[element].listValue && detected.parameters.fields[element].listValue.values.length !== 0) {
											// get multiple words that are attached to one single entity
											parameters.push({
												[element]: detected.parameters.fields[element].listValue.values.map(obj => obj.stringValue),
											});
										}
									}

									return {
										success: true, whatWasSaid: detected.queryText, intentName: detected.displayName, parameters,
									};
								} // no text, user didn't say anything/no speech was detected
								return { success: false, textMsg: 'Não consegui ouvir o que você disse. Por favor, tente novamente.' };
							}).catch(async (err) => {
								console.error('ERROR:', err);
								await checkAndDelete(fileIn);
								await checkAndDelete(fileOut);
								return { success: false, textMsg: 'Não entendi o que você disse. Por favor, tente novamente.' };
							});
						testeAudio(result);
					} else { // audio has 60+ seconds
						await checkAndDelete(fileIn);
						await checkAndDelete(fileOut);
						testeAudio({ success: false, textMsg: 'Áudio muito longo! Por favor, mande áudio com menos de 1 minuto!' });
					}
				});
			} else { // code not 0
				console.log('Não foi possível converter os arquivos');
				await checkAndDelete(fileIn);
				await checkAndDelete(fileOut);
				testeAudio({ success: false, textMsg: 'Não entendi o que você disse. Por favor, tente novamente.' });
			}
		}); // dir.onExit
	});
}

module.exports.voiceRequest = voiceRequest;

// const url = 'https://cdn.fbsbx.com/v/t59.3654-21/40458034_2311624535532596_1690151012016324608_n.mp4/audioclip-1536260400000-2392.mp4?_nc_cat=0&oh=521ecefd5c3b24c537b025685aec27de&oe=5B945708';

// voiceRequest(url, '123123');
