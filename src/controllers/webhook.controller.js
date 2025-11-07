const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { geminiService, wahaService } = require('../services');
const { WebhookEvent } = require('../models');

const handleWebhook = catchAsync(async (req, res) => {
  // Here you can process the webhook payload.
  // The payload is available in req.body after being parsed and validated.
  // console.log('Webhook received:', JSON.stringify(req.body, null, 2));

  if (req.body.event === 'message' && req.body.payload && req.body.payload.id) {
    const eventId = req.body.payload.id;

    // Idempotency Check: See if we've processed this event ID before.
    const existingEvent = await WebhookEvent.findOne({ eventId });
    if (existingEvent) {
      console.log(`Duplicate event received, ignoring: ${eventId}`);
      return res.status(httpStatus.OK).send({ status: 'duplicate_ignored' });
    }

    // If it's a new event, save it to prevent future duplicates, then process.
    await WebhookEvent.create({ eventId });

    const messagePayload = req.body.payload;
    console.log(`New ${req.body.event} from ${messagePayload.from} to ${messagePayload.to}: ${messagePayload.body}`);

    // Mark the message as seen immediately
    await wahaService.sendSeen(messagePayload.from);
    // Add your business logic here (e.g., save to a database, trigger another event, etc.)
    const userInput = messagePayload.body;

    // 1. Determine Intent
    const { intent } = await geminiService.determineIntent(userInput);
    console.log(`Determined intent: ${intent}`);

    let finalResponse;

    // 2. Execute based on intent
    if (intent === 'transaction') {
      const transactionData = await geminiService.processTransaction(userInput);
      console.log('Transaction data:', transactionData);
      // Here you would call the Firefly III API with transactionData
      finalResponse = transactionData.message_to_user;
    } else {
      const answer = await geminiService.getAnswer(userInput);
      console.log('Answer:', answer.content);
      finalResponse = answer.content;
    }
    // Send the reply back to the user who sent the message.
    console.log(`Final response to user: ${finalResponse}`);
    await wahaService.sendTextMessage(messagePayload.from, finalResponse);
  }

  res.status(httpStatus.OK).send({ status: 'received' });
});

module.exports = {
  handleWebhook,
};
