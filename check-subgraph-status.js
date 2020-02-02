let { sendAlert } = require('./utils.js');

const dotenv = require("dotenv");
dotenv.config();

const axios = require('axios')
axios.defaults.timeout = 30000;
const fs = require('fs')

let GRAPH_NODE_SUBGRAPH_URL = '';

function reportEmergency(data, url) {
  sendAlert(
    "Subgraph Failed! " + data, 
    url + " Subgraph Failed! " +
    data +
    ". Please restart the server and run this bot again. If the issue remains check the logs for relevant data."
  );
}

function reportIDChanged(url, oldID, newID) {
  sendAlert(
    "Subgraph ID changed.", 
    "Subgraph: " + url + " ID changed from: " + oldID + " to: " + newID
  );
}

function reportDataMismatch() {
  sendAlert(
    "Subgraph Data Mismatch.", 
    "The data from the self-hosted subgraph does not match the data from The Graph servers. Please check for possible issues."
  );
}

function sendSubgraphError(error) {
  sendAlert(
    "Subgraph Query Failed.", 
    "Subgraph query failed to call " + process.env.SUBGRAPH_URL + " with error: \n" + error
  );
}

function sendAlchemySwitchedSubgraph(prevURL, newURL) {
  sendAlert(
    "Alchemy Switched Production Subgraph URL", 
    "Alchemy has switched its production URL from: " + prevURL + " to: " + newURL
  );
}

async function updateAlchemySettings() {
  const exportingString = "module.exports = { settings };";
  let alchemySettingsFile = (await axios.get('https://raw.githubusercontent.com/daostack/alchemy/master/src/settings.ts')).data;
  fs.writeFileSync(
    './alchemy-settings.js',
    alchemySettingsFile.split('export')[1] + exportingString,
    'utf-8'
  );
  let alchemySettings = require('./alchemy-settings').settings;
  if (alchemySettings.production.graphqlHttpProvider !== GRAPH_NODE_SUBGRAPH_URL) {
    sendAlchemySwitchedSubgraph(GRAPH_NODE_SUBGRAPH_URL, alchemySettings.production.graphqlHttpProvider)
  }
  GRAPH_NODE_SUBGRAPH_URL = alchemySettings.production.graphqlHttpProvider;
  
  console.log('Alchemy production subgraph URL: ' + GRAPH_NODE_SUBGRAPH_URL);
}

  function checkStatus(isGraphNodeServer, { id, failed, synced, latestEthereumBlockNumber }) {
    if (isGraphNodeServer) {
      if (lastGraphNodeSubgraphId != undefined && id !== lastGraphNodeSubgraphId) {
        reportIDChanged(GRAPH_NODE_SUBGRAPH_URL, lastGraphNodeSubgraphId, id);
      }
      lastGraphNodeSubgraphId = id;
    } else {
      if (lastSubgraphId != undefined && id !== lastSubgraphId) {
        reportIDChanged(process.env.SUBGRAPH_URL, lastSubgraphId, id);
      }
      lastSubgraphId = id;
    }
    if (!failed) {
      if (synced) {
        console.log("No errors detected, Subgraph running normally");
      } else {
        console.log("Subgraph syncing, no failure detected.");
      }
    } else {
      reportEmergency("Last Synced Block: " + latestEthereumBlockNumber, isGraphNodeServer ? GRAPH_NODE_SUBGRAPH_URL : process.env.SUBGRAPH_URL);
    }
  }

  async function monitorSubgraph() {

    const query = `{
      subgraphs {
        name
        currentVersion {
          deployment {
            id
            latestEthereumBlockNumber
            totalEthereumBlocksCount
            synced
            failed
          }
        }
      }
    }`

    try {
        let { data } = (await axios.post(process.env.GRAPH_NODE_URL, { query })).data
        for (let i in data.subgraphs) {
          if (data.subgraphs[i].name === process.env.SUBGRAPH_NAME) {
            let id = data.subgraphs[i].currentVersion.deployment.id
            let failed = data.subgraphs[i].currentVersion.deployment.failed
            let synced = data.subgraphs[i].currentVersion.deployment.synced
            let latestEthereumBlockNumber = data.subgraphs[i].currentVersion.deployment.latestEthereumBlockNumber
            return { id, failed, synced, latestEthereumBlockNumber }
          }
        }
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, process.env.SUBGRAPH_URL)
    }
  }

  async function monitorGraphNodeSubgraph() {
    const query = `{
      indexingStatusesForSubgraphName(subgraphName: "daostack/` + GRAPH_NODE_SUBGRAPH_URL.split('https://api.thegraph.com/subgraphs/name/daostack/')[1] + `") { subgraph synced failed chains { network ... on EthereumIndexingStatus { latestBlock { number hash } chainHeadBlock { number hash } } } }
    }`

    try {
      let { data } = (await axios.post("https://api.thegraph.com/index-node/graphql", { query })).data
      if (data.indexingStatusesForSubgraphName !== []) {
        let id = data.indexingStatusesForSubgraphName[0].subgraph
        let failed = data.indexingStatusesForSubgraphName[0].failed
        let synced = data.indexingStatusesForSubgraphName[0].synced
        let latestEthereumBlockNumber = data.indexingStatusesForSubgraphName[0].chains[0].latestBlock.number
        return { id, failed, synced, latestEthereumBlockNumber }
      }
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, GRAPH_NODE_SUBGRAPH_URL)
    }
  }

  async function verifyDataMatch() {
    const query = `{
      proposals(where: {stage: "Boosted"}, orderBy: createdAt) {
        id
        votes {
          reputation
          outcome
          createdAt
        }
        stakes {
          staker
          outcome
          createdAt
        }
        votesFor
        votesAgainst
        stakesFor
        stakesAgainst
        paramsHash
        title
      }
    }`
    let dataSubgraph
    try {
      dataSubgraph= (await axios.post(process.env.SUBGRAPH_URL, { query })).data.data
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, process.env.SUBGRAPH_URL)
      return
    }

    try {
      let { data: dataGraphNode } = (await axios.post(GRAPH_NODE_SUBGRAPH_URL, { query })).data
      if (dataSubgraph.toString() === dataGraphNode.toString()) {
        console.log("Data match correctly.");
      } else {
        reportDataMismatch();
      }
    } catch (e) {
      console.log(e)
      sendSubgraphError(e, GRAPH_NODE_SUBGRAPH_URL)
    }
  }

  let lastSubgraphId, lastGraphNodeSubgraphId
  module.exports = {
    verifySubgraphs: async function verifySubgraphs() {
      try {
        await updateAlchemySettings();
        checkStatus(true, await monitorGraphNodeSubgraph());
        checkStatus(false, await monitorSubgraph());
        verifyDataMatch();
      } catch (e) {
        console.log(e)
        sendSubgraphError(e)
      }
    },
  };
