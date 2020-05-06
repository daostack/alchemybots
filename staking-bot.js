const dotenv = require("dotenv");
dotenv.config();

const axios = require('axios')
axios.defaults.timeout = 30000;

function getStakingInstructions(proposals, botAccount) {
    let results = {}
    for (let proposal of proposals) {
        for (let { staker } of proposal.stakes) {
            if (staker === botAccount.toLowerCase()) {
                results[proposal.id] = 0
                break;
            }
        }
        if (results[proposal.id] !== 0) {
            results[proposal.id] = 100;
        }
    }
    return results;
  }
  

module.exports = {
    getStakingInstructions
};
