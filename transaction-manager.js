
  var redisInterface = require('./redis-interface')

  const Tx = require('ethereumjs-tx')

  var tokenContractJSON = require('./contracts/_0xBitcoinToken.json');
  var deployedContractInfo = require('./contracts/DeployedContractInfo.json');

  var web3utils = require('web3-utils')

const GAS_PRICE_GWEI = 4;
module.exports =  {

  //use redis to store the past payments

  async init(payments,accountConfig,web3)
  {
      console.log('init transaction manager')

      this.accountConfig = accountConfig;
      this.web3=web3;

      this.tokenContractAddress = deployedContractInfo.networks.mainnet.contracts._0xbitcointoken.blockchain_address;

      this.tokenContract =  new web3.eth.Contract(tokenContractJSON.abi,this.tokenContractAddress )

      await redisInterface.init();


      await redisInterface.dropList('paybot_queued_payments');

      for(var key in payments)
      {

        var paymentStatus = {
          queued:true,
          pending:false,
          mined:false,
          broadcasted: false,
          success:false
        }


        var existingPayment = await redisInterface.findHashInRedis('paybot_payment',key)

        var paymentData = {
          address: key,
          tokenAmount: payments[key],
          paymentStatus:paymentStatus,
          paymentUUID: web3utils.randomHex(32)
        }


        if(existingPayment == null)
        {
          console.log('\n')
          console.log('adding',key,payments[key])

          await redisInterface.storeRedisHashData('paybot_payment',key, JSON.stringify(paymentData))
          var existingPayment = await redisInterface.findHashInRedis('paybot_payment',key)
        }


        var existingPaymentData = JSON.parse(existingPayment);

        if(existingPaymentData.paymentStatus.mined==false)
        {

          await redisInterface.pushToRedisList('paybot_queued_payments',JSON.stringify(paymentData))
        }

      }


      var self = this;


       setTimeout(function(){self.sendTransfers()},0)
      setTimeout(function(){self.monitorTransfers()},0)


  },

     async sendTransfers()
     {
       var self = this;
       console.log('send transfers');

       var statistics = await this.getPaymentStatistics();

       var queuedCount = statistics.queuedCount;
       var pendingCount = statistics.pendingCount;

       var hasQueuedTransaction = (queuedCount > 0);
       var hasPendingTransaction = (pendingCount > 0);

       console.log('queuedCount',queuedCount)
        console.log('pendingCount',pendingCount)

        if( hasQueuedTransaction && !hasPendingTransaction ){

          var previewQueuedTransactionData = await redisInterface.peekFromRedisList('paybot_queued_payments'  )


            console.log(previewQueuedTransactionData)

          var previewQueuedTransaction = JSON.parse(previewQueuedTransactionData)
          var previewQueuedTransactionAddressTo = previewQueuedTransaction.address;


          var matchingPaymentData = await redisInterface.findHashInRedis('paybot_payment',previewQueuedTransactionAddressTo);
          var matchingPayment = JSON.parse(matchingPaymentData)


          console.log(matchingPayment)

            if(matchingPayment!=null && matchingPayment.tokenAmount >= 1 && matchingPayment.paymentStatus.broadcasted != true )
            {
                  var nextQueuedTransactionData = await redisInterface.popFromRedisList('paybot_queued_payments'  )
                  var nextQueuedTransaction = JSON.parse(nextQueuedTransactionData)

                  await this.handlePaymentTransaction( nextQueuedTransaction );
            }else{
              var nextQueuedTransactionData = await redisInterface.popFromRedisList('paybot_queued_payments'  )

              console.log('skipping transaction....')
            }



        }


       setTimeout(function(){self.sendTransfers()},1000)
     },

     async handlePaymentTransaction(payment)
     {
       console.log('handle',payment)


         var tx_hash = await this.transferTokens(payment.address,payment.tokenAmount,payment.paymentUUID)

         if(tx_hash == null){

           console.log('tx not broadcast successfully')
         }else{
             console.log('broadcasted transaction -> ',tx_hash);


             var ethBlock = await this.getEthBlockNumber();

             var existingPayment = await redisInterface.findHashInRedis('paybot_payment',payment.address)
             var existingPaymentData = JSON.parse(existingPayment);

             existingPaymentData.txHash = tx_hash;

             existingPaymentData.paymentStatus.queued = false;
             existingPaymentData.paymentStatus.pending = true;
             existingPaymentData.paymentStatus.broadcasted = true;
             existingPaymentData.lastBroadcastedAtBlock = ethBlock;

            if(existingPayment)
            {
              console.log('storing new data for ', tx_hash)
              await redisInterface.storeRedisHashData('paybot_payment',payment.address,JSON.stringify(existingPaymentData) )

            }


         }
     },




     async monitorTransfers()
     {

       var payment_txes = await redisInterface.getResultsOfKeyInRedis('paybot_payment')

       if( payment_txes != null && payment_txes.length > 0)
       {
          var response = await this.checkMinedTransfers( payment_txes )
       }


      var self = this;

        setTimeout(function(){self.monitorTransfers()},1000)

     },

     async checkMinedTransfers(transfers)
     {
       console.log('check mined')
       var ethBlock = await this.getEthBlockNumber();
       for(i in transfers)
       {
         var addressTo = transfers[i];
         var txDataJSON = await redisInterface.findHashInRedis('paybot_payment',addressTo);
         var transactionData = JSON.parse(txDataJSON)

         var txHash = transactionData.txHash;




          //if it has been  pending for too long then rebroadcast it
         if( transactionData.paymentStatus.pending == true
          // && transactionData.paymentStatus.broadcasted == true
           && transactionData.paymentStatus.mined == false
           &&  (transactionData.lastBroadcastedAtBlock == null || transactionData.lastBroadcastedAtBlock < (ethBlock - 250) ) )
         {

           console.log('transaction was pending for too long - recycling',txHash)

           transactionData.paymentStatus.pending = false;
           transactionData.paymentStatus.broadcasted = false;

           await redisInterface.storeRedisHashData('paybot_payment',addressTo,JSON.stringify(transactionData) )


           continue;
         }

         if( transactionData.paymentStatus.broadcasted == true
           &&  transactionData.paymentStatus.mined == false )
         {
           console.log('get receipt for ', txHash)


           var liveTransactionReceipt = await this.requestTransactionReceipt(txHash)


           if(liveTransactionReceipt != null )
           {
             transactionData.paymentStatus.pending = false;
             transactionData.paymentStatus.mined = true;

             var transaction_succeeded =  (web3utils.hexToNumber( liveTransactionReceipt.status) == 1 )

             if( transaction_succeeded )
             {
               transactionData.paymentStatus.succeeded = true;
               console.log('transaction was mined and succeeded',txHash)
             }else {
               console.log('transaction was mined and failed',txHash)
             }

             await redisInterface.storeRedisHashData('paybot_payment',addressTo,JSON.stringify(transactionData) )


           }


         }
       }
     },

     async requestTransactionReceipt(tx_hash)
     {

          var receipt = await this.web3.eth.getTransactionReceipt(tx_hash);

          return receipt;
     },

     async transferTokens(recipientAddress,amount,paymentUUID)
     {
        console.log('transfer tokens ')


       var addressTo = this.tokenContract.options.address;
       var addressFrom = this.getPaymentAccount().address;

       var transferMethod = this.tokenContract.methods.transfer(addressTo,amount);


       var ethBlock = await this.getEthBlockNumber();


       try{
         var txCount = await this.web3.eth.getTransactionCount(addressFrom);
         console.log('txCount',txCount)
        } catch(error) {  //here goes if someAsyncPromise() rejected}
         console.log(error);

          return error;    //this will result in a resolved promise.
        }


        var txData = this.web3.eth.abi.encodeFunctionCall({
                name: 'transfer',
                type: 'function',
                inputs: [{
                    type: 'address',
                    name: 'to'
                },{
                    type: 'uint256',
                    name: 'tokens'
                }]
            }, [recipientAddress, amount]);


            var max_gas_cost = 1704624;

            var estimatedGasCost = await transferMethod.estimateGas({gas: max_gas_cost, from:addressFrom, to: addressTo });

            if( estimatedGasCost > max_gas_cost){
              console.log("Gas estimate too high!  Something went wrong ")
              return;
            }

            const txOptions = {
              nonce: web3utils.toHex(txCount),
              gas: web3utils.toHex(1704624),
              gasPrice: web3utils.toHex(web3utils.toWei(GAS_PRICE_GWEI.toString(), 'gwei') ),
              value: 0,
              to: addressTo,
              from: addressFrom,
              data: txData
            }

            var privateKey =  this.getPaymentAccount().privateKey;

            return new Promise(function (result,error) {

                 this.sendSignedRawTransaction(this.web3,txOptions,addressFrom,privateKey, function(err, res) {
                  if (err) error(err)
                    result(res)
                })

              }.bind(this));


     },


     async sendSignedRawTransaction(web3,txOptions,addressFrom,private_key,callback) {

       var privKey = this.truncate0xFromString( private_key )

       const privateKey = new Buffer( privKey, 'hex')
       const transaction = new Tx(txOptions)


       transaction.sign(privateKey)


       const serializedTx = transaction.serialize().toString('hex')

         try
         {
           var result =  web3.eth.sendSignedTransaction('0x' + serializedTx, callback)
         }catch(e)
         {
           console.log('error',e);
         }
     },

     truncate0xFromString(s)
    {
      if(s.startsWith('0x')){
        return s.substring(2);
      }
      return s;
    },



     async getEthBlockNumber()
     {
       return await this.web3.eth.getBlockNumber()
       },

      getPaymentAccount()
     {
        return this.accountConfig.payment;
     },

     async getPaymentStatistics()
     {
       var queuedCount = 0;
       var pendingCount = 0;

       var paymentHashes = await redisInterface.getResultsOfKeyInRedis('paybot_payment')
       var payments = [];

       for(i in paymentHashes){
         var hash = paymentHashes[i];
        var paymentData = ( await redisInterface.findHashInRedis('paybot_payment',hash) )
         payments.push( JSON.parse( paymentData ) )
       }


       payments.map(function(item){

      //   console.log(item.paymentStatus)


         if(item.paymentStatus.queued )
         {
           queuedCount++;
         }

         if(item.paymentStatus.pending )
         {
           pendingCount++;
         }

       });


       return {
         queuedCount:queuedCount,
          pendingCount:pendingCount
       }
     }

}
