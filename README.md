# Alchemy Bot
A script to boost and execute Genesis Protocol proposals.

## Running the script:
1. Create a `.env` file and specify the following parameters:
```
NETWORK = <NETWORK THE BOT RUNS ON>
PRIVATE_KEY = <BOT ACCOUNT FOR TXS>
WEB3_WS_PROVIDER = <ETHEREUM WEBB SOCKET URL>
GAS_PRICE = <DEFAULT GAS PRICE TO USE> # dxdao uses ethgasstation.info instead
SENDER=<SENDER EMAIL FOR NOTIFICATIONS>
RECEIVER=<RECEIVERS EMAIL FOR NOTIFICATIONS>
PASSWORD=<SENDER EMAIL PASSWORD FOR NOTIFICATIONS>

SUBGRAPH_NAME= <NAME OF BACKUP SUBGRAPH TO MONITOR> # i.e. "v41_8" 
GRAPH_NODE_URL= <URL OF BACKUP SUBGRAPH `subgraphs` endpoint> # i.e. "http://ec2-3-19-3-204.us-east-2.compute.amazonaws.com:8000/subgraphs"
SUBGRAPH_URL= <URL OF BACKUP SUBGRAPH> # i.e. "http://ec2-3-19-3-204.us-east-2.compute.amazonaws.com:8000/subgraphs/name/v41_8"
GRAPH_NODE_SUBGRAPH_URL=<URL OF SUBGRAPH TO CHECK IF PROPOSALS EXIST IN INDEXED SCHEME> #i.e. "https://api.thegraph.com/subgraphs/name/daostack/v41_8"
TG_BOT=<TELEGRAM BOT API TOKEN>
TG_CHAT_ID=<TELEGRAM BOT CHAT ID>
GRAPH_NODE_SUBGRAPH_NAME=<CURRENT SUBGRAPH VERSION FOR LOG MESSAGES> # i.e. "v41_8"
DX_DAO_PRIVATE_KEY=<DXDAO BOT ACCOUNT PRIVATE KEY>
```
2. Open a terminal window within the bot directory and type out the following:
```
npm install
npm run start
```

3. The bot will start scanning the blockchain for expired proposals which were not executed and will attempt to execute any expired proposals found. Then listen and wait for events.

*Note: Please make sure you have some ETH in the account you entered the private key for in the .env file in order to pay for the transaction gas costs.*

4. To see logs from the bot, run:
```
npm run logs
```

5. To stop the bot, run:
```
npm run stop
```