const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { geminiService, wahaService, actualService } = require('../services');
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
    const { intent, transactionDetail } = await geminiService.determineIntent(userInput);
    console.log(`Determined intent: ${intent}`);

    let finalResponse;

    // 2. Execute based on intent
    if (intent === 'transaction') {
      // --- Actual Budget Integration ---
      try {
        await actualService.init();
        // 1. Fetch accounts and categories to provide context to the AI
        const [accounts, categories, payees] = await Promise.all([
          actualService.getAccounts(),
          actualService.getCategories(),
          actualService.getPayees(),
        ]);

        const accountNames = accounts.map((acc) => acc.name);
        const categoryNames = categories.map((cat) => cat.name);

        const transactionData = await geminiService.processTransaction(userInput, accountNames, categoryNames);
        console.log('Transaction data:', transactionData);

        // 2. Find the matching account and category IDs from the AI's response
        const account = accounts.find((acc) => acc.name.toLowerCase() === transactionData.source_account_name.toLowerCase());

        if (!account) {
          finalResponse = `Sorry, I couldn't find an account named "${transactionData.source_account_name}".`;
        } else {
          const amountInCents = parseFloat(transactionData.amount) * 100;
          const today = new Date().toISOString().split('T')[0]; // Today's date in YYYY-MM-DD

          if (transactionDetail === 'transfer') {
            const destinationAccount = accounts.find((acc) => acc.name.toLowerCase() === transactionData.payee.toLowerCase());
            if (!destinationAccount) {
              finalResponse = `Sorry, I couldn't find a destination account named "${transactionData.payee}" for the transfer.`;
            } else {
              // For a transfer, we need to create two transactions.
              // 1. A withdrawal from the source account.
              // 2. A deposit into the destination account.
              // These are linked by using the internal transfer payees.

              const sourceTransferPayee = payees.find((p) => p.transfer_acct === account.id);
              const destinationTransferPayee = payees.find((p) => p.transfer_acct === destinationAccount.id);

              if (!destinationTransferPayee) {
                finalResponse = `Sorry, I couldn't find the internal transfer payee for account "${destinationAccount.name}".`;
              } else if (!sourceTransferPayee) {
                finalResponse = `Sorry, I couldn't find the internal transfer payee for account "${account.name}".`;
              } else {
                const withdrawal = {
                  date: today,
                  amount: -Math.abs(amountInCents),
                  payee: destinationTransferPayee.id,
                  notes: transactionData.description || `Transfer to ${destinationAccount.name}`,
                  cleared: false
                };
                const deposit = {
                  date: today,
                  amount: Math.abs(amountInCents),
                  payee: sourceTransferPayee.id,
                  notes: transactionData.description || `Transfer from ${account.name}`,
                  cleared: false
                };
                // Add the withdrawal to the source account and the deposit to the destination account.
                await actualService.addTransactions(account.id, [withdrawal]);
                await actualService.addTransactions(destinationAccount.id, [deposit]);
                finalResponse = transactionData.message_to_user;
              }
            }
          } else {
            // Handle Income or Expense
            const category = categories.find((cat) => cat.name.toLowerCase() === transactionData.category.toLowerCase());

            if (!category) {
              finalResponse = `Sorry, I couldn't find a category named "${transactionData.category}".`;
            } else {
              const newTransaction = {
                date: today,
                // Amount is positive for income, negative for expense
                amount: transactionDetail === 'income' ? Math.abs(amountInCents) : -Math.abs(amountInCents),
                notes: transactionData.description,
                category: category.id,
                payee_name: transactionData.payee,
                cleared: false
              };
              await actualService.addTransactions(account.id, [newTransaction]);
              finalResponse = transactionData.message_to_user;
            }
          }
          // This line was redundant and could overwrite more specific error messages
          // finalResponse = transactionData.message_to_user;
        }
      } catch (error) {
        console.error('Error during Actual Budget integration:', error);
        finalResponse = "Sorry, I encountered an error while processing your transaction with Actual Budget.";
        // Re-throw the error to be caught by catchAsync and logged properly
        throw error;
      } finally {
        await actualService.shutdown();
      }
    } else if (intent === 'query_balance') {
      try {
        await actualService.init();
        const [accounts, categories] = await Promise.all([actualService.getAccounts(), actualService.getCategories()]);

        const accountNames = accounts.map((acc) => acc.name);
        const categoryNames = categories.map((cat) => cat.name);

        const queryData = await geminiService.processBalanceQuery(userInput, accountNames, categoryNames);
        console.log('Balance query data:', queryData);

        if (queryData.query_type === 'account') {
          let responseParts = [];
          if (queryData.name.toLowerCase() === 'all') {
            responseParts.push('*🏦 All Account Balances:*');
            // Create an array of promises to fetch all account balances concurrently
            const balancePromises = accounts.map(async (acc) => {
              if (!acc.closed) {
                const balance = await actualService.getAccountBalance(acc.id);
                const formattedBalance = formatIDR(balance / 100);
                return `*${acc.name}:* ${formattedBalance}`;
              }
              return null;
            });
            const balanceLines = (await Promise.all(balancePromises)).filter(Boolean);
            responseParts.push(...balanceLines);
          } else {
            const account = accounts.find((acc) => acc.name.toLowerCase() === queryData.name.toLowerCase());
            if (account) {
              const balance = await actualService.getAccountBalance(account.id);
              const formattedBalance = formatIDR(balance / 100);
              responseParts.push(`*🏦 Account Balance:*`);
              responseParts.push(`*${account.name}:* ${formattedBalance}`);
            } else {
              responseParts.push(`Sorry, I couldn't find an account named "${queryData.name}".`);
            }
          }
          finalResponse = responseParts.join('\n');
        } else if (queryData.query_type === 'budget' || queryData.query_type === 'summary') {
          const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
          const budgetData = await actualService.getBudgetMonth(month);
          console.log(budgetData)

          if (queryData.name && queryData.name.toLowerCase() !== 'all') {
            const category = budgetData.categorGroups
              .flatMap((group) => group.categories)
              .find((cat) => cat.name.toLowerCase() === queryData.name.toLowerCase());

            if (category) {
              const budgeted = formatIDR(category.budgeted / 100); // e.g., 200000000 -> Rp 2.000.000,00
              const spent = formatIDR(Math.abs(category.spent / 100)); // spent is negative, so use Math.abs
              const balance = formatIDR(category.balance / 100);
              finalResponse = `*📊 Budget for ${category.name}:*\n- *Budgeted:* ${budgeted}\n- *Spent:* ${spent}\n- *Remaining:* ${balance}`;
            } else {
              finalResponse = `Sorry, I couldn't find a budget category named "${queryData.name}".`;
            }
          } else {
            // Summary of all budgets
            let responseParts = ['*📊 Monthly Budget Summary:*'];
            budgetData.categoryGroups.forEach((group) => {
              if (!group.is_income) {
                responseParts.push(`\n*${group.name}*`);
                group.categories.forEach((cat) => {
                  const balance = formatIDR(cat.balance / 100); // e.g., 259562700 -> Rp 2.595.627,00
                  responseParts.push(`- ${cat.name}: ${balance}`);
                });
              }
            });
            finalResponse = responseParts.join('\n');
          }
        }
      } catch (error) {
        console.error('Error during balance query:', error);
        finalResponse = 'Sorry, I had trouble fetching your balance information.';
        throw error;
      } finally {
        await actualService.shutdown();
      }
    } else if (intent === 'question') {
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

const formatIDR = (amount) => {
  // Formats a number into IDR currency string, e.g., 150000 -> Rp 150.000,00
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(amount);
};

module.exports = {
  handleWebhook,
};
