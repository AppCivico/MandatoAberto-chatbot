const request = require('requisition');

const VotoLegalapiUri = process.env.VOTO_LEGAL_API_URL;
console.log(`${VotoLegalapiUri}/api/candidate/`);

module.exports = {
	async getVotoLegalValues(username) {
		console.log(`${VotoLegalapiUri}/api/candidate/${username}`);
		const res = await request(`${VotoLegalapiUri}/api/candidate/${username}`);
		const votolegal = await res.json();
		return votolegal;
	},

};
