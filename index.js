console.log('starting paybot')


var fs = require("fs");

var transactionManager = require('./transaction-manager');

var accountConfig = require('./account.config').accounts;

var owedPaymentContent = fs.readFileSync("./owed_payment.json");
var owedPayments = JSON.parse(owedPaymentContent).owedPayments;

async function init()
{
  //console.log(owedPayments)

  transactionManager.init(owedPayments,accountConfig);



}

init();
