let {
    sendAlert,
    log,
    getNonce
} = require('./utils.js');
require('dotenv').config();

const axios = require('axios')
axios.defaults.timeout = 30000;

// CONSTS
const network = process.env.NETWORK;

async function callCommonUpdater(proposalId, blockNumber) {
    try {
        await axios.get(process.env.COMMON_UPDATING_URL + '?proposalId=' + proposalId + (blockNumber != null ? '?blockNumber=' + blockNumber : '') + '&retries=4');
    } catch (error) {
        const { response } = error;
        let errStr = '';
        if (response) {
        // eslint-disable-next-line no-unused-vars
        const { request, ...errorObject } = response;
        errStr = JSON.stringify(errorObject);
        }
        console.log(process.env.COMMON_UPDATING_URL + '?proposalId=' + proposalId + (blockNumber != null ? '?blockNumber=' + blockNumber : '') + '&retries=4')
        sendAlert('Failed to update Common: ' + network, 'Error calling Common URL: ' + process.env.COMMON_UPDATING_URL + '?proposalId=' + proposalId + (blockNumber != null ? '?blockNumber=' + blockNumber : '') + '&retries=4\nError: ' + error + '\nDetails: ' + errStr);
    }
}

async function runRedeemJoin(proposalId, web3, gasPrice) {
    const query = `{
      proposals(where: {${proposalId !== null ? 'id: "' + proposalId +'", ': ''}join_not: null, stage: "Executed"}, orderBy: executedAt, orderDirection: desc) {
        id
        stage
        join {
          reputationMinted
        }
        winningOutcome
        scheme {
          address
          version
        }
      }
    }`
    let { data } = (await axios.post(process.env.SUBGRAPH_URL, { query })).data
    if (data === undefined) {
        // Proposal already executed or couldn't be found
        return;
    }
    for (let proposal of data.proposals) {
      if (proposal.join.reputationMinted !== "0" || proposal.winningOutcome == 'Fail') {
        continue;
      }
      if (!require('@daostack/migration-experimental/contracts/' + proposal.scheme.version + '/Join.json')) {
        return;
      }
      const Join = require('@daostack/migration-experimental/contracts/' + proposal.scheme.version + '/Join.json').abi;
      let join = new web3.eth.Contract(Join, proposal.scheme.address);
      join.methods
      .redeemReputation(proposal.id)
      .send(
        {
          from: web3.eth.defaultAccount,
          gas: 300000,
          gasPrice: web3.utils.toWei(gasPrice, 'gwei'),
          nonce: (await getNonce(web3))
        },
        async function(error) {
          if (error) {
            log(error);
          } else {
            log('Redeem transaction for proposal: ' + proposal.id + ' was sent.');
          }
        }
      )
      .on('confirmation', async function(_, receipt) {
        log(
          'Join reputation redeem transaction: ' +
            receipt.transactionHash +
            ' for proposal: ' +
            proposal.id +
            ' was successfully confirmed.'
        );
      })
      .on('error', console.error);
    }
}

// Staking

async function stake(proposalId, stakeAmount, genesisProtocol, web3, gasPrice) {
    await genesisProtocol.methods
    .stake(proposalId, 1, stakeAmount)
    .send(
      {
        from: web3.eth.defaultAccount,
        gas: 500000,
        gasPrice: web3.utils.toWei(gasPrice, 'gwei'),
        nonce: (await getNonce(web3))
      },
      async function(error) {
        if (error) {
          log(error);
        }
      }
    )
    .on('confirmation', async function(_, receipt) {
      log(
        'Staking transaction: ' +
          receipt.transactionHash +
          ' for proposal: ' +
          proposalId +
          ' was successfully confirmed.'
      );
    })
    .on('error', console.error);
  }
  
  async function runStaking(web3, gasPrice) {
    // List of schemes types we should look for proposals to stake on
    const COMMON_SCHEMES = ['join', 'fundingRequest']
    for (let schemeType of COMMON_SCHEMES) {
        // Currently limited to first 1000 open proposals.
        const query = `{
            proposals(where: {${schemeType}_not: null, stage: "Queued"}, orderBy: createdAt, first: 1000, orderDirection: desc) {
                id
                join {
                    id
                }
                fundingRequest {
                    id
                }
                stakes {
                    staker
                }
                votesFor
                votesAgainst
                stakesFor
                stakesAgainst
                votingMachine
                join {
                    funding
                }
                fundingRequest {
                    amount
                }
                dao {
                    id
                    nativeReputation {
                        totalSupply
                    }
                }
                scheme {
                    numberOfBoostedProposals
                    numberOfPreBoostedProposals
                }
                gpQueue {
                    threshold
                }
                genesisProtocolParams {
                    minimumDaoBounty
                }
            }
        }`
        log("runStaking!")
        try {
            let { data } = (await axios.post(process.env.SUBGRAPH_URL, { query })).data
            let { proposals } = data
            for (let proposal of proposals) {
                if (proposal.genesisProtocolParams.minimumDaoBounty.toString() != '1') {
                    continue;
                }
                let stakeAmount = 30; //web3.utils.toWei('10') // Comment out logic for now... web3.utils.toWei(getStakingInstructions(proposal, web3.eth.defaultAccount).toString())
                let version = require('./package.json').dependencies['@daostack/migration-experimental'].split('-v')[0];
                const GenesisProtocol = require('@daostack/migration-experimental/contracts/' + version + '/GenesisProtocol.json').abi;
                let genesisProtocol = new web3.eth.Contract(GenesisProtocol, proposal.votingMachine);
                stake(proposal.id, stakeAmount, genesisProtocol, web3, gasPrice)
            }
        } catch (e) {
            console.log(e)
        }
    }
  }

  async function redeemJoinCommon(web3, data, genesisProtocol, proposalId, gasPrice) {
    const Redeemer = require('@daostack/migration-experimental/contracts/0.1.2-rc.6/Redeemer.json').abi;
    const DAOstackMigration = require('@daostack/migration-experimental');
    let migration = DAOstackMigration.migration(network);
    let redeemer = new web3.eth.Contract(Redeemer, migration.package['0.1.2-rc.6'].Redeemer);
    redeemer.methods
        .redeemJoin(data.proposal.scheme.address, genesisProtocol.address, proposalId, web3.eth.defaultAccount)
        .send(
          {
            from: web3.eth.defaultAccount,
            gas: 600000,
            gasPrice: web3.utils.toWei(gasPrice, 'gwei'),
            nonce: (await getNonce(web3))
          },
          async function(error) {
            if (error) {
              log(error);
            } else {
              log('Redeem transaction for proposal: ' + proposalId + ' was sent.');
            }
          }
        )
        .on('confirmation', async function(_, receipt) {
          log(
            'Join reputation redeem transaction: ' +
              receipt.transactionHash +
              ' for proposal: ' +
              proposalId +
              ' was successfully confirmed.'
          );
          if (process.env.COMMON.toLowerCase() != 'false') {
            callCommonUpdater(proposalId, receipt.blockNumber);
          }
        })
        .on('error', console.error);
  }


module.exports = {
    redeemJoinCommon,
    callCommonUpdater,
    runRedeemJoin,
    runStaking
};
