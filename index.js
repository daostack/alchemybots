let {
  sendAlert,
  extractJSON,
  convertMillisToTime,
  log,
  getNonce
} = require('./utils.js');

const {
  callCommonUpdater,
  runRedeemJoin,
  runStaking
} = require('./common.js')
require('dotenv').config();

const axios = require('axios')
axios.defaults.timeout = 30000;

let network = process.env.NETWORK;
let privateKey = process.env.PRIVATE_KEY;
let web3WSProvider = process.env.WEB3_WS_PROVIDER;
let gasPrice = process.env.GAS_PRICE;

// Setting up Web3 instance
const Web3 = require('web3');
const web3 = new Web3(new Web3.providers.WebsocketProvider(web3WSProvider));
let account = web3.eth.accounts.privateKeyToAccount(privateKey);
web3.eth.accounts.wallet.add(account);
web3.eth.defaultAccount = account.address;

const DAOstackMigration = require('@daostack/migration-experimental');

// List all active timers by proposalId
let activeTimers = {};

// List of all redeemed proposals
let redeemedProposals = {};

const retryLimit = 5;
// List of all retries of proposals executions
let retriedCount = {};

let stakingBotTimerId;

const UNSUPPORTED_VERSIONS = [
  "0.1.2-rc.0", "0.1.2-rc.1", "0.1.2-rc.2", "0.1.2-rc.3", "0.1.2-rc.4"
];

////////////// Functions //////////////

// Get gas price to use
async function getGasPrice() {
  if (network != 'mainnet') {
    return gasPrice;
  }
  let ethGasStationPrices = (await axios.get('https://ethgasstation.info/api/ethgasAPI.json')).data;
  if (ethGasStationPrices.fastest / 10 > 200) {
    return '200';
  }
  return (ethGasStationPrices.fastest / 10).toString();
}

async function listenProposalsStateChanges(genesisProtocol) {
  let scanFromBlock = (await web3.eth.getBlockNumber()) - 518400; // 3 months

  // Start listening to events
  genesisProtocol.events
    .StateChange({ fromBlock: scanFromBlock }, async (error, events) => {
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

        if (process.env.COMMON.toLowerCase() != 'false') {
          callCommonUpdater(proposalId, null)
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
        } else if (proposalState === 2 && proposal.state === 2) {
          if (process.env.COMMON.toLowerCase() != 'false') {
            runRedeemJoin(proposalId, web3, await getGasPrice());
          }
        }
      } else {
        log('Failed to start event listener');
        console.log(error);
      }
    })
    .on('error', console.error);

  genesisProtocol.events
    .NewProposal({ fromBlock: scanFromBlock }, async (error, events) => {

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
        log('Failed to start event listener 3');
        console.log(error);
      }
    })
    .on('error', console.error);
}

async function setPreBoostingTimer(genesisProtocol, proposalId, timerDelay) {
  // Setup timer for the pre-boosting time
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;

    let proposal = await genesisProtocol.methods.proposals(proposalId).call();
    if (proposal.state === 4) {
      // Boost the proposal or return it to Queue
      await genesisProtocol.methods
        .execute(proposalId)
        .send(
          {
            from: web3.eth.defaultAccount,
            gas: 300000,
            gasPrice: web3.utils.toWei(await getGasPrice(), 'gwei'),
            nonce: (await getNonce(web3))
          },
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
        .on('confirmation', async function(_, receipt) {
          log(
            'Boosting transaction: ' +
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
  }, timerDelay);
}

async function setExecutionTimer(genesisProtocol, proposalId, timerDelay) {
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;
    log(
      'Proposal: ' + proposalId + ' has expired. Attempting to redeem proposal.'
    );
    // Check if Join, if yes, call redeemReputation with the proposal ID
    const query = `{
      proposal(id: "${proposalId.toLowerCase()}") {
        winningOutcome
        scheme {
          name
          address
          version
          isRegistered
        }
      }
    }`
    let { data } = (await axios.post(process.env.SUBGRAPH_URL, { query })).data
    // Check if the proposal scheme is registered to the dao
    if (!data.proposal.scheme.isRegistered) {
      log(
        'Could not call execute Proposal: ' +
          proposalId +
          '. Scheme is not registered in the DAO anymore'
      );
    }
    // Check if can close the proposal as expired and claim the bounty
    let failed = false;
    let executable = await genesisProtocol.methods
      .execute(proposalId)
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
      executable
    ) {
      if ((data.proposal.scheme.name === "Join" && process.env.COMMON.toLowerCase() != 'false') && data.proposal.winningOutcome != 'Fail') {
        const Redeemer = require('@daostack/migration-experimental/contracts/0.1.2-rc.6/Redeemer.json').abi;
        let migration = DAOstackMigration.migration(network);
        let redeemer = new web3.eth.Contract(Redeemer, migration.package['0.1.2-rc.6'].Redeemer);
        redeemer.methods
        .redeemJoin(data.proposal.scheme.address, genesisProtocol.address, proposalId, web3.eth.defaultAccount)
        .send(
          {
            from: web3.eth.defaultAccount,
            gas: 600000,
            gasPrice: web3.utils.toWei(await getGasPrice(), 'gwei'),
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
      } else {
        // Close the proposal as expired and claim the bounty
        await genesisProtocol.methods
        .execute(proposalId)
        .send(
          {
            from: web3.eth.defaultAccount,
            gas: 300000,
            gasPrice: web3.utils.toWei(await getGasPrice(), 'gwei'),
            nonce: (await getNonce(web3))
          },
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
        .on('confirmation', async function(_, receipt) {
          log(
            'Execution transaction: ' +
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
    } else {
      log(
        'Failed to execute proposal:' +
          proposalId
      );
    }
  }, timerDelay);
}

async function setExpirationTimer(genesisProtocol, proposalId, timerDelay) {
  activeTimers[proposalId] = setTimeout(async () => {
    activeTimers[proposalId] = undefined;

    log(
      'Proposal: ' +
        proposalId +
        ' has expired in queue. Attempting to execute proposal.'
    );

    // Check if can close the proposal as expired

    // Close the proposal as expired
    await genesisProtocol.methods
      .execute(proposalId)
      .send(
        {
          from: web3.eth.defaultAccount,
          gas: 300000,
          gasPrice: web3.utils.toWei(await getGasPrice(), 'gwei'),
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
          'Execution transaction: ' +
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
    let subject = 'Alchemy execution bot needs more ETH on ' + network;
    let text =
      'The Alchemy execution bot has low ETH balance, soon transactions will stop being broadcasted, please add add ETH to fix this.\nBot address: ' +
      web3.eth.defaultAccount + ' current balance: ' + web3.utils.fromWei(botEthBalance) + ' ETH';

    sendAlert(subject, text);
  }
}

function restart() {
  log('Restarting Bot...');
  process.exit(0);
}

async function startBot() {
  process.on('unhandledRejection', error => {
    log('unhandledRejection: ' + error.message);
    sendAlert(
      'Alchemy bot encountered an unexpected error',
      'unhandledRejection: ' +
        error.message +
        '\nPlease check the bot immediately'
    );
  });

  // Setup Genesis Protocol
  let migration = DAOstackMigration.migration(network);
  let activeVMs = [];
  
  for (let version in migration.package) {
    // if (version !== require('./package.json').dependencies['@daostack/migration-experimental'].split('-v')[0]) {
    //   continue;
    // }
    if (UNSUPPORTED_VERSIONS.indexOf(version) !== -1) {
      continue;
    }
    const GenesisProtocol = require('@daostack/migration-experimental/contracts/' +
      version +
      '/GenesisProtocol.json').abi;
    let gpAddress = migration.package[version].GenesisProtocol;
    if (activeVMs.indexOf(gpAddress) !== -1) {
      continue;
    }
    activeVMs.push(gpAddress);
    let genesisProtocol = new web3.eth.Contract(GenesisProtocol, gpAddress);
    // Subscribe to StateChange events of the Genesis Protocol
    log(
      'Started listening to StateChange events of Genesis Protocol: ' +
        gpAddress +
        ' on ' +
        network +
        ' network'
    );

    await listenProposalsStateChanges(genesisProtocol);
  }
  setTimeout(restart, 1000 * 60 * 60 * 6);
  await checkIfLowGas();
  if (process.env.COMMON.toLowerCase() == 'false') {
    return;
  }
  const STAKING_TIMER_INTERVAL = 5 * 60 * 1000; // 5 minutes
  stakingBotTimerId = setInterval(
    async function() {
      runStaking(web3, await getGasPrice());
      await checkIfLowGas();
    },
    STAKING_TIMER_INTERVAL
  );

  runRedeemJoin(null, web3, await getGasPrice());
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
