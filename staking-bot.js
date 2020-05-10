const BN = require('bn.js')
const dotenv = require("dotenv");
dotenv.config();

const axios = require('axios')
axios.defaults.timeout = 30000;
  
function realMathToNumber(t) {
    const REAL_FBITS = 40
    const fraction = t.maskn(REAL_FBITS).toNumber() / Math.pow(2, REAL_FBITS)
    return t.shrn(REAL_FBITS).toNumber() + fraction
  }

function getStakeSize(proposal) {
    const stakeSizeSanityCheck = 1000 //TODO: what is a good value for this number?
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
    return min(stake, stakeSizeSanityCheck);
}

function toStake(proposal, botAccount, maxNumberOfProposalsToBoost) {
    // TODO: don't stake on a propsal if fundingRequest / dao.totalFunds > maxFundingRequest
    let returnValue = true
    // don't stake on the same proposal twice
    for (let { staker } of proposal.stakes) {
        if (staker === botAccount.toLowerCase()) { 
            returnValue = false
        }
    }
    // don't stake on a proposal with too many boosted proposals
    if (proposal.numberOfPreBoostedProposals + proposal.numberOfBoostedProposals > maxNumberOfProposalsToBoost){
        returnValue = false
    }
    return returnValue;
}

function stakingLogic(proposal, minVotesVolume, minVotesConfidence) {
    let stake = 0
    // funding requests logic
    let votesConfidence = propsal.votesFor / proposal.votesAgainst
    let votesVolume = (proposal.votesFor + proposal.votesAgainst) / proposal.dao.nativeReputation.totalSupply
    if (votesConfidence > minVotesConfidence && votesVolume > minVotesVolume){ 
        stake = getStakeSize(proposal);
    }
    // reputation requests logic
    else if (proposal.joinAndQuit.funding > 0) { // boost all proposals which send funds to the DAO
        let fundingAmount = proposal.fundingAmount.amount
        if (fundingAmount == 0 || fundingAmount == null){ // only boost rep requests which don't ask for funding 
            stake = getStakeSize(proposal)
        }
    }
    return stake;
}

function getStakingInstructions(proposal, botAccount) {
    // These params define which proposals get staked on.
    const minVotesVolume = 0.1
    const minVotesConfidence = 2
    const maxNumberOfProposalsToBoost = 50
    let stake = 0
    if (toStake(proposal, botAccount, maxNumberOfProposalsToBoost)){
        stake = stakingLogic(proposal, minVotesVolume, minVotesConfidence)
    }
    return stake;
}

module.exports = {
    getStakingInstructions
};
  