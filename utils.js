function sendAlert(subject, text) {
    let sender = process.env.SENDER;
    let receiver = process.env.RECEIVER;
    let password = process.env.PASSWORD;
  
    var nodemailer = require("nodemailer");
        
    const axios = require('axios');
    axios({
      method: 'post',
      url: 'https://api.telegram.org/' + process.env.TG_BOT + '/sendMessage?chat_id=' + process.env.TG_CHAT_ID + '&parse_mode=HTML&text=<b>' + subject + '</b>\n' + text + '\n<a href="https://thegraph.com/explorer/subgraph/daostack/alchemy?selected=logs">Subgraph Logs</a>\n',
    });
    
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
      subject,
      text
    };
  
    transporter.sendMail(mailOptions, function(error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
        throw Error();
      }
    });
}

// Extract error JSON object from the error string
function extractJSON(str) {
  var firstOpen, firstClose, candidate;
  firstOpen = str.indexOf("{", firstOpen + 1);
  do {
    firstClose = str.lastIndexOf("}");
    if (firstClose <= firstOpen) {
      return null;
    }
    do {
      candidate = str.substring(firstOpen, firstClose + 1);
      try {
        var res = JSON.parse(candidate);
        return [res, firstOpen, firstClose + 1];
      } catch (e) {
        log("JSON error parsing failed.");
      }
      firstClose = str.substr(0, firstClose).lastIndexOf("}");
    } while (firstClose > firstOpen);
    firstOpen = str.indexOf("{", firstOpen + 1);
  } while (firstOpen !== -1);
}

// Get timer delay as readable time
function convertMillisToTime(millis) {
  let delim = " ";
  let hours = Math.floor(millis / (1000 * 60 * 60));
  millis -= hours * (1000 * 60 * 60);
  let minutes = Math.floor(millis / (1000 * 60));
  millis -= minutes * (1000 * 60);
  let seconds = Math.floor(millis / 1000);
  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;
  return hours + "h" + delim + minutes + "m" + delim + seconds + "s";
}

function log(message) {
  let logMsg =
    new Date().toLocaleString("en-US", { hour12: false }) +
    " | " +
    message +
    "\n";
  console.log(logMsg);
}

module.exports = {
    sendAlert,
    extractJSON,
    convertMillisToTime,
    log
};
  
