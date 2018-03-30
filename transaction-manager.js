
  var redisInterface = require('./redis-interface')


module.exports =  {

  //use redis to store the past payments

  async init(payments,accountConfig)
  {
      console.log('init transaction manager')

      await redisInterface.init();



      for(var key in payments)
      {

        var paymentStatus = {
          queued:true,
          pending:false,
          mined:false,
          success:false
        }


        await redisInterface.dropList('paybot_queued_payments');

        var existingPayment = await redisInterface.findHashInRedis('paybot_payment',key)

        var paymentData = {address: key, tokenAmount: payments[key],paymentStatus:paymentStatus}


        if(existingPayment == null)
        {
          console.log('\n')
          console.log('adding',key,payments[key])


          var existingPayment = await redisInterface.storeRedisHashData('paybot_payment',key, JSON.stringify(paymentData))
        }


        var existingPaymentData = JSON.parse(existingPayment);

        if(existingPaymentData.paymentStatus.success==false)
        {

          await redisInterface.pushToRedisList('paybot_queued_payments',JSON.stringify(paymentData))
        }

      }


      var self = this;


      setTimeout(function(){self.sendTransfers()},0)


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

        if( hasQueuedTransaction && !hasPendingTransaction ){

          var nextQueuedTransactionData = await redisInterface.popFromRedisList('paybot_queued_payments'  )

          this.handlePaymentTransaction( nextQueuedTransactionData );
        }


       setTimeout(function(){self.sendTransfers()},1000)
     },

     async handlePaymentTransaction(payment)
     {
       console.log('handle',payment)
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
