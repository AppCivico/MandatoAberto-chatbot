const request = require('requisition');

const VotoLegalapiUri = process.env.VOTO_LEGAL_API_URL;

module.exports = {
	async getVotoLegalValues(username) {
		const res = await request(`${VotoLegalapiUri}/api/candidate/${username}`);
		const votolegal = await res.json();
		return votolegal;
	},

};
