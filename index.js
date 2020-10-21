let {
  sendAlert,
  extractJSON,
  convertMillisToTime,
  log
} = require('./utils.js');
let { verifySubgraphs } = require('./check-subgraph-status.js');
require('dotenv').config();

const axios = require('axios')
axios.defaults.timeout = 30000;

let network = process.env.NETWORK;
let privateKey = process.env.PRIVATE_KEY;
let dxdaoPrivateKey = process.env.DX_DAO_PRIVATE_KEY;
let web3WSProvider = process.env.WEB3_WS_PROVIDER;
let gasPrice = process.env.GAS_PRICE;
let GRAPH_NODE_SUBGRAPH_URL = process.env.GRAPH_NODE_SUBGRAPH_URL;
let nonce = -1;

// Setting up Web3 instance
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.WebsocketProvider(web3WSProvider));
let account = web3.eth.accounts.privateKeyToAccount(privateKey);
let dxdaoAccount = web3.eth.accounts.privateKeyToAccount(dxdaoPrivateKey);
web3.eth.accounts.wallet.add(account);
web3.eth.accounts.wallet.add(dxdaoAccount);
web3.eth.defaultAccount = account.address;
let dxdaoAddress = dxdaoAccount.address;

async function getTxParams(tx, genesisProtocol, proposalId) {
  const query = `{
    proposal(id: "${proposalId.toLowerCase()}") {
      id
    }
  }`

  let { data } = (await axios.post(GRAPH_NODE_SUBGRAPH_URL, { query })).data

  try {
    if (data.proposal.id.toLowerCase() != proposalId.toLowerCase()) {
      throw Error('Proposal was not found')
    }
  } catch {
    return null
  }
  


  let proposal = await genesisProtocol.methods.proposals(proposalId).call();
  let dao = (await genesisProtocol.methods.organizations(proposal.organizationId).call()).toLowerCase();


  let ethGasStationPrices = (await axios.get('https://ethgasstation.info/api/ethgasAPI.json')).data
  let txGasPrice =  web3.utils.toWei(
    (dao === '0x519b70055af55a007110b4ff99b0ea33071c720a' ? ((ethGasStationPrices.fastest / 10) + 30) : gasPrice).toString(),
    'gwei'
  )

  let txFrom = dao === '0x519b70055af55a007110b4ff99b0ea33071c720a' ? dxdaoAddress : web3.eth.defaultAccount;

  let txNonce = (await web3.eth.getTransactionCount(txFrom, 'pending'));

  let gas = 0;
  const blockLimit = (await web3.eth.getBlock('latest')).gasLimit
  try {
    gas = (await tx.estimateGas())
    if (gas * 1.5 < blockLimit - 100000) {
      gas *= 1.5
      gas = parseInt(gas)
    } else {
      gas = blockLimit - 100000
    }
  } catch (error) {
    if (error.toString().indexOf('always failing transaction') !== -1) {
      log('Skipping transaction for proposal: ' + proposalId + ' reason: ' + error)
      return null
    }
    gas = blockLimit - 100000
    if (gas < 9000000) {
      gas = 9000000;
    }
  }
  return {
    from: txFrom,
    gas,
    gasPrice: txGasPrice,
    nonce: txNonce
  }
}

// List all active timers by proposalId
let activeTimers = {};

// List of all redeemed proposals
let redeemedProposals = {};

const retryLimit = 5;
// List of all retries of proposals executions
let retriedCount = {};

// Subgraph Monitoring Bot timer ID
let subgraphMonitorTimerId;

let lastUnhandledRejectionErrorTime = 0;

////////////// Functions //////////////

async function listenProposalsStateChanges(genesisProtocol) {
  let scanFromBlock = (await web3.eth.getBlockNumber()) - 1036800; // 6 months

  // Start listening to events
  genesisProtocol.events
    .StateChange({ fromBlock: scanFromBlock }, async (error, events) => {
      if (nonce === -1) {
        nonce =
          (await web3.eth.getTransactionCount(web3.eth.defaultAccount)) - 1;
      }

      if (!error) {
        // Get the proposal and Genesis Protocol data
        let proposalId = events.returnValues._proposalId;
        let proposalState = events.returnValues._proposalState;
        let proposal = await genesisProtocol.methods
          .proposals(proposalId)
          .call();

        if (proposal === null) {
          log(
            proposalId +
              ' on voting machine ' +
              genesisProtocol.address +
              'returned as null'
          );
          return;
        }

        // Clear past timeouts if existed
        clearTimer(proposalId);

        // If entered into Boosted or Quiet Ending state
        if (
          (proposalState === 5 || proposalState === 6) &&
          (proposal.state === 5 || proposal.state === 6)
        ) {
          // Calculate the milliseconds until expiration
          let timerDelay = await calculateTimerDelay(
            genesisProtocol,
            proposalId,
            proposal
          );
          if (timerDelay !== -1) {
            log(
              'Proposal: ' +
                proposalId +
                ' entered ' +
                (proposalState === 5 ? 'Boosted' : 'Quiet Ending') +
                ' Phase. Expiration timer has been set to: ' +
                (timerDelay !== 0 ? convertMillisToTime(timerDelay) : 'now')
            );
            // Setup timer for the expiration time
            await setExecutionTimer(genesisProtocol, proposalId, timerDelay);
          }
        } else if (proposalState === 4 && proposal.state === 4) {
          let timerDelay = await calculatePreBoostedTimerDelay(
            genesisProtocol,
            proposalId,
            proposal
          );
          if (timerDelay !== -1) {
            log(
              'Proposal: ' +
                proposalId +
                ' entered Pre-Boosted Phase. Boosting timer has been set to: ' +
                (timerDelay !== 0 ? convertMillisToTime(timerDelay) : 'now')
            );
            await setPreBoostingTimer(
              genesisProtocol,
              proposalId,
              timerDelay + 10000
            );
          }
        } else if (proposalState === 3 && proposal.state === 3) {
          // Calculate the milliseconds until expiration
          let timerDelay = await calculateExpirationInQueueTimerDelay(
            genesisProtocol,
            proposalId,
            proposal
          );
          if (timerDelay !== -1) {
            log(
              'Proposal: ' +
                proposalId +
                ' entered the Queue. Expiration timer has been set to: ' +
                (timerDelay !== 0 ? convertMillisToTime(timerDelay) : 'now')
            );
            // Setup timer for the expiration time
            await setExpirationTimer(genesisProtocol, proposalId, timerDelay);
          }
        }
      } else {
        log('Failed to start event listener');
      }
    })
    .on('error', console.error);

  genesisProtocol.events
    .NewProposal({ fromBlock: scanFromBlock }, async (error, events) => {
      if (nonce === -1) {
        nonce =
          (await web3.eth.getTransactionCount(web3.eth.defaultAccount)) - 1;
      }

      if (!error) {
        let proposalId = events.returnValues._proposalId;
        let proposal = await genesisProtocol.methods
          .proposals(proposalId)
          .call();

        // Calculate the milliseconds until expiration
        if (proposal.state === 3) {
          let timerDelay = await calculateExpirationInQueueTimerDelay(
            genesisProtocol,
            proposalId,
            proposal
          );
          if (timerDelay !== -1) {
            log(
              'Proposal: ' +
                proposalId +
                ' entered the Queue. Expiration timer has been set to: ' +
                (timerDelay !== 0 ? convertMillisToTime(timerDelay) : 'now')
            );
            // Setup timer for the expiration time
            await setExpirationTimer(genesisProtocol, proposalId, timerDelay);
          }
        }
      } else {
        log('Failed to start event listener');
      }
    })
    .on('error', console.error);
}

async function setPreBoostingTimer(genesisProtocol, proposalId, timerDelay) {
  // Setup timer for the pre-boosting time
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;
    await checkIfLowGas();

    let proposal = await genesisProtocol.methods.proposals(proposalId).call();
    if (proposal.state === 4) {
      // Boost the proposal or return it to Queue
    let executeTx = await genesisProtocol.methods.execute(proposalId)
    let params = await getTxParams(executeTx, genesisProtocol, proposalId);
    if (params == null) {
      log('Skipping proposal: ' + proposalId + ' as it was not found on the subgraph')
      return
    }
    executeTx.send(
          params,
          function(error, transactionHash) {
            if (!error) {
              log(
                'Proposal: ' +
                  proposalId +
                  ' was successfully executed: ' +
                  transactionHash
              );
            } else {
              log(
                Date.now() +
                  ' | Could not execute Proposal: ' +
                  proposalId +
                  '. error returned: ' +
                  extractJSON(error.toString())[0].message
              );
            }
          }
        )
        .on('confirmation', function(_, receipt) {
          log(
            'Boosting transaction: ' +
              receipt.transactionHash +
              ' for proposal: ' +
              proposalId +
              ' was successfully confirmed.'
          );
        })
        .on('error', console.error);
    }
  }, timerDelay);
}

async function setExecutionTimer(genesisProtocol, proposalId, timerDelay) {
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;
    await checkIfLowGas();
    log(
      'Proposal: ' + proposalId + ' has expired. Attempting to redeem proposal.'
    );

    // Check if can close the proposal as expired and claim the bounty
    let failed = false;
    let expirationCallBounty = await genesisProtocol.methods
      .executeBoosted(proposalId)
      .call()
      .catch(error => {
        log(
          'Could not call execute Proposal: ' +
            proposalId +
            '. error returned: ' +
            extractJSON(error.toString())[0].message
        );
        failed = true;
      });
    if (
      !failed &&
      expirationCallBounty !== null &&
      Number(web3.utils.fromWei(expirationCallBounty.toString())) > 0
    ) {
      // Close the proposal as expired and claim the bounty
      let executeTx = await genesisProtocol.methods.execute(proposalId)
      let params = await getTxParams(executeTx, genesisProtocol, proposalId);
      if (params == null) {
        log('Skipping proposal: ' + proposalId + ' as it was not found on the subgraph')
        return
      }
      executeTx.send(
        params,
          async function(error) {
            if (error) {
              log(error);
            }
            activeTimers[proposalId] = setTimeout(async () => {
              retriedCount[proposalId] !== undefined
                ? retriedCount[proposalId]++
                : (retriedCount[proposalId] = 1);
              await retryExecuteProposal(genesisProtocol, proposalId, error);
            }, 10000);
          }
        )
        .on('confirmation', function(_, receipt) {
          log(
            'Execution transaction: ' +
              receipt.transactionHash +
              ' for proposal: ' +
              proposalId +
              ' was successfully confirmed.'
          );
        })
        .on('error', console.error);
    } else {
      log(
        'Failed to execute proposal:' +
          proposalId +
          ' for ' +
          expirationCallBounty +
          ' GEN'
      );
    }
  }, timerDelay);
}

async function setExpirationTimer(genesisProtocol, proposalId, timerDelay) {
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;
    await checkIfLowGas();

    log(
      'Proposal: ' +
        proposalId +
        ' has expired in queue. Attempting to execute proposal.'
    );

    // Check if can close the proposal as expired and claim the bounty

    // Close the proposal as expired and claim the bounty
    let executeTx = await genesisProtocol.methods.execute(proposalId)
    let params = await getTxParams(executeTx, genesisProtocol, proposalId);
    if (params == null) {
      log('Skipping proposal: ' + proposalId + ' as it was not found on the subgraph')
      return
    }
    executeTx.send(
        params,
        async function(error) {
          if (error) {
            log(error);
          }
        }
      )
      .on('confirmation', function(_, receipt) {
        log(
          'Execution transaction: ' +
            receipt.transactionHash +
            ' for proposal: ' +
            proposalId +
            ' was successfully confirmed.'
        );
      })
      .on('error', console.error);
  }, timerDelay);
}

async function retryExecuteProposal(genesisProtocol, proposalId, error) {
  let proposal = await genesisProtocol.methods.proposals(proposalId).call();
  if (proposal.state !== 2) {
    let errorMsg = extractJSON(error.toString());
    log(
      'Could not execute Proposal: ' +
        proposalId +
        '. error returned: ' +
        (errorMsg !== null ? errorMsg[0].message : error)
    );
    if (retriedCount[proposalId] <= retryLimit) {
      log('Retrying...');
      retriedCount[proposalId]++;
      let timerDelay = await calculateTimerDelay(
        genesisProtocol,
        proposalId,
        proposal
      );
      if (timerDelay !== -1) {
        setExecutionTimer(genesisProtocol, proposalId, timerDelay + 5000);
      }
    } else {
      log('Too many retries, proposal execution abandoned.');
    }
  } else {
    log('Proposal: ' + proposalId + ' was execute.');
  }
}

async function listenProposalBountyRedeemed(genesisProtocol) {
  let fromBlock = await web3.eth.getBlockNumber();
  genesisProtocol.events
    .ExpirationCallBounty(
      {
        fromBlock
      },
      async (error, events) => {
        if (!error) {
          let proposalId = events.returnValues._proposalId;
          let beneficiary = events.returnValues._beneficiary;
          let amount = events.returnValues._amount;
          clearTimer(proposalId);
          redeemedProposals[proposalId] = {
            beneficiary,
            amount
          };
          if (
            web3.eth.defaultAccount.toLowerCase() === beneficiary.toLowerCase()
          ) {
            log(
              'Proposal: ' +
                proposalId +
                ' has expired and was successfully executed: ' +
                events.transactionHash +
                '\nReward received for execution: ' +
                web3.utils.fromWei(amount.toString()) +
                ' GEN'
            );
          } else {
            log(
              'Proposal: ' +
                proposalId +
                ' was redeemed by another account: ' +
                beneficiary +
                '\nReward received for execution: ' +
                web3.utils.fromWei(amount.toString()) +
                ' GEN'
            );
          }
        }
      }
    )
    .on('error', console.error);
}

// Timer Delay calculator for expiration in Queue
async function calculateExpirationInQueueTimerDelay(
  genesisProtocol,
  proposalId,
  proposal
) {
  // Calculate the milliseconds until expiring in queue
  let proposedTime = (
    await genesisProtocol.methods.getProposalTimes(proposalId).call()
  )[0].toNumber();
  let queuedVotePeriod = (
    await genesisProtocol.methods.parameters(proposal.paramsHash).call()
  ).queuedVotePeriodLimit.toNumber();
  let timerDelay = (queuedVotePeriod + proposedTime) * 1000 - Date.now();
  if (timerDelay < 0) {
    timerDelay = 0;
  }
  const safetyDelay = 20000; // This is a small dlay to make sure time differentials will not cause an issue
  timerDelay += safetyDelay;
  if (timerDelay > 2 ** 31 - 1) {
    return -1;
  }
  return timerDelay;
}

// Timer Delay calculator
async function calculateTimerDelay(genesisProtocol, proposalId, proposal) {
  // Calculate the milliseconds until boosting ends
  let boostedTime = (
    await genesisProtocol.methods.getProposalTimes(proposalId).call()
  )[1].toNumber();
  let boostingPeriod = proposal.currentBoostedVotePeriodLimit.toNumber();
  let timerDelay = (boostingPeriod + boostedTime) * 1000 - Date.now();
  if (timerDelay < 0) {
    timerDelay = 0;
  }
  if (timerDelay > 2 ** 31 - 1) {
    return -1;
  }
  return timerDelay;
}

async function calculatePreBoostedTimerDelay(
  genesisProtocol,
  proposalId,
  proposal
) {
  // Calculate the milliseconds until pre-boosting ends
  let preBoostedTime = (
    await genesisProtocol.methods.getProposalTimes(proposalId).call()
  )[2].toNumber();
  let preBoostingPeriod = (
    await genesisProtocol.methods.parameters(proposal.paramsHash).call()
  ).preBoostedVotePeriodLimit.toNumber();
  let timerDelay = (preBoostingPeriod + preBoostedTime) * 1000 - Date.now();
  if (timerDelay < 0) {
    timerDelay = 0;
  }
  if (timerDelay > 2 ** 31 - 1) {
    return -1;
  }
  return timerDelay;
}

function clearTimer(proposalId) {
  if (activeTimers[proposalId] !== undefined) {
    clearTimeout(activeTimers[proposalId]);
    activeTimers[proposalId] = undefined;
    log('Proposal: ' + proposalId + ' state changed. Stopping timer.');
  }
}

async function checkIfLowGas() {
  let botEthBalance = await web3.eth.getBalance(web3.eth.defaultAccount);
  if (botEthBalance < 100000000000000000) {
    // 0.1 ETH
    let subject = 'Alchemy execution bot needs more ETH';
    let text =
      'The Alchemy execution bot has low ETH balance, soon transactions will stop being broadcasted, please add add ETH to fix this.\nBot address: ' +
      web3.eth.defaultAccount;

    sendAlert(subject, text);
  }
}

function restart() {
  log('Restarting Bot...');
  process.exit(0);
}

async function startBot() {
  process.on('unhandledRejection', error => {
    if (lastUnhandledRejectionErrorTime < Date.now() - 1000 * 60 * 5) {
      lastUnhandledRejectionErrorTime = Date.now();
      log('unhandledRejection: ' + error.message);
      sendAlert(
        'Alchemy bot encountered an unexpected error',
        'unhandledRejection: ' +
          error.message +
          '\nPlease check the bot immediately'
      );
    }
  });

  // Setup Genesis Protocol
  const DAOstackMigration = require('@daostack/migration');
  let migration = DAOstackMigration.migration(network);
  let activeVMs = [];
  for (let version in migration.base) {
    const GenesisProtocol = require('@daostack/migration/contracts/' +
      version +
      '/GenesisProtocol.json').abi;
    let gpAddress = migration.base[version].GenesisProtocol;
    if (activeVMs.indexOf(gpAddress) !== -1) {
      continue;
    }
    activeVMs.push(gpAddress);
    let genesisProtocol = new web3.eth.Contract(GenesisProtocol, gpAddress);
    // Subscrice to StateChange events of the Genesis Protocol
    log(
      'Started listening to StateChange events of Genesis Protocol: ' +
        gpAddress +
        ' on ' +
        network +
        ' network'
    );

    await listenProposalsStateChanges(genesisProtocol);
    await listenProposalBountyRedeemed(genesisProtocol);
  }
  setTimeout(restart, 1000 * 60 * 60 * 6);

  const SUBGRAPH_TIMER_INTERVAL = 5 * 60 * 1000; // 5 minutes
  subgraphMonitorTimerId = setInterval(
    verifySubgraphs,
    SUBGRAPH_TIMER_INTERVAL
  );
}

if (require.main === module) {
  startBot().catch(err => {
    console.log(err);
  });
} else {
  module.exports = {
    startBot
  };
}
