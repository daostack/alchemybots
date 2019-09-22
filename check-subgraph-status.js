const dotenv = require("dotenv");
dotenv.config();

function reportEmergency(data) {
    let sender = process.env.SENDER;
    let receiver = process.env.SUBGRAPH_RECEIVER;
    let password = process.env.PASSWORD;
  
    var nodemailer = require("nodemailer");
  
    var transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: sender,
        pass: password
      }
    });
  
    var mailOptions = {
      from: sender,
      to: receiver,
      subject: "Subgraph Failed! " + data,
      text:
        "Subgraph Failed! " +
        data +
        ". Please restart the server and run this bot again. If the issue remains check the logs for relevant data."
    };
  
    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
        clearInterval(timerId);
        throw Error();
      }
    });
  }
  
  export async function monitorSubgraph() {
    const axios = require('axios')

    const query = `{
      subgraphs {
        name
        currentVersion {
          deployment {
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
        for (i in data.subgraphs) {
          if (data.subgraphs[i].name == process.env.SUBGRAPH_NAME) {
            let failed = data.subgraphs[i].currentVersion.deployment.failed
            let synced = data.subgraphs[i].currentVersion.deployment.synced
            let latestEthereumBlockNumber = data.subgraphs[i].currentVersion.deployment.latestEthereumBlockNumber
            if (!failed) {
              if (synced) {
                console.log("No errors detected, Subgraph running normally");
              } else {
                console.log("Subgraph syncing, no failure detected.");
              }
            } else {
              reportEmergency("Last Synced Block: " + latestEthereumBlockNumber);
            }
            break
          }
        }
    } catch (e) {
        console.log(e)
    }
  }