const request = require('requisition');

const VotoLegalapiUri = process.env.VOTO_LEGAL_API_URL;

module.exports = {
	async getVotoLegalValues(username) {
		// ?id=josehernandes#/
		const res = await request(`${VotoLegalapiUri}/api/candidate/?id=${username}#`);
		const votolegal = await res.json();
		return votolegal;
	},

};
