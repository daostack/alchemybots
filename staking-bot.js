const BN = require('bn.js')
const dotenv = require("dotenv");
dotenv.config();

const axios = require('axios')
axios.defaults.timeout = 30000;

function getStakingInstructions(proposal, botAccount) {
    for (let { staker } of proposal.stakes) {
        if (staker === botAccount.toLowerCase()) {
            return 0
        }
    }
    if (proposal.numberOfPreBoostedProposals + proposal.numberOfBoostedProposals > 50) {
        return 0
    }

    const threshold = realMathToNumber(new BN(proposal.gpQueue.threshold))
    const stakesFor = new BN(proposal.stakesFor)
    const stakesAgainst = new BN(proposal.stakesAgainst)
    /**
     * for doing multiplication between floating point (threshold) and BN numbers
     */
    const PRECISION = Math.pow(2, 40)
    let stake = new BN(threshold * PRECISION)
        .mul(stakesAgainst)
        .div(new BN(PRECISION))
        .sub(stakesFor)
    return stake;
  }
  
  function realMathToNumber(t) {
    const REAL_FBITS = 40
    const fraction = t.maskn(REAL_FBITS).toNumber() / Math.pow(2, REAL_FBITS)
    return t.shrn(REAL_FBITS).toNumber() + fraction
  }

module.exports = {
    getStakingInstructions
};
