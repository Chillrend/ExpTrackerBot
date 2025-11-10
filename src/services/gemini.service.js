const { GoogleGenerativeAI } = require('@google/generative-ai');
const httpStatus = require('http-status');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
});

/**
 * Determines the user's intent from the text.
 * @param {string} text - The text to process.
 * @returns {Promise<object>} An object with the determined intent.
 */
const determineIntent = async (text) => {
  try {
    const intentZodSchema = z.object({
      intent: z
        .enum(['transaction', 'question', 'query_balance'])
        .describe(
          'The determined intent of the user input. "transaction" for financial recordings, "query_balance" for asking about account or budget balances, "question" for everything else.'
        ),
      transactionDetail: z
        .enum(['expense', 'income', 'transfer'])
        .describe(
          'If the intent is "transaction", specify the type. "expense" is money out (e.g., buying something), "income" is money in (e.g., salary), "transfer" is moving money between two of the user\'s own accounts.'
        ),
    });

    const intentJsonSchema = zodToJsonSchema(intentZodSchema);

    const modelWithSchema = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: intentJsonSchema,
      },
    });

    const prompt = `Analyze the user's text and determine the intent.
*   If the text is about recording an expense, income, or transfer, the intent is "transaction".
*   If the text is about asking for an account balance or budget status, the intent is "query_balance".
*   Otherwise, the intent is "question".

User input: "${text}"`;

    const result = await modelWithSchema.generateContent(prompt);
    const responseJson = JSON.parse(result.response.text());

    const validatedData = intentZodSchema.parse(responseJson);
    return validatedData;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Gemini response validation error (determineIntent): ${error.message}`
      );
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Gemini API Error (determineIntent): ${error.message}`);
  }
};

/**
 * Extracts transaction details from text.
 * @param {string} text - The text describing a transaction.
 * @param {string[]} accountNames - An array of available account names.
 * @param {string[]} categoryNames - An array of available category names.
 * @returns {Promise<object>} A structured transaction object.
 */
const processTransaction = async (text, accountNames, categoryNames) => {
  try {
    // 1. Define the schema for the transaction output using Zod
    const transactionZodSchema = z.object({
      description: z.string().describe('A clear description of the transaction.'),
      amount: z.string().describe("The numeric amount as a string, parsed from formats like '20k' to '20000'."),
      category: z.enum(categoryNames).describe('The category for the transaction, chosen from the provided list.'),
      payee: z
        .string()
        .nullable()
        .describe(
          'The person or business being paid for an expense, or the source of funds for an income. For a transfer, this should be the name of the destination account, chosen from the available accounts list.'
        ),
      source_account_name: z
        .enum(accountNames)
        .describe(
          'The account the money is coming from, chosen from the provided list. Chose Other if can not be determined'
        ),
      message_to_user: z.string().describe('A short summary on what you just done, use emojis if necessary.'),
    });

    // 2. Convert the Zod schema to a JSON schema
    const transactionJsonSchema = zodToJsonSchema(transactionZodSchema);

    // 3. Configure the model with the generated JSON schema
    const modelWithSchema = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: transactionJsonSchema,
      },
    });

    // 4. Create a simpler prompt, as the schema handles the structure
    const prompt = `You are a financial assistant. Extract transaction details from the following user input, which is in Indonesian.

Available accounts: ${accountNames.join(', ')}
Available categories: ${categoryNames.join(', ')}
"${text}"`;

    const result = await modelWithSchema.generateContent(prompt);
    const responseJson = JSON.parse(result.response.text());

    // 5. Validate the response against the Zod schema
    const validatedData = transactionZodSchema.parse(responseJson);

    return validatedData;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Gemini response validation error: ${error.message}`);
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Gemini API Error (processTransaction): ${error.message}`);
  }
};

/**
 * Extracts balance query details from text.
 * @param {string} text - The text describing a balance query.
 * @param {string[]} accountNames - An array of available account names.
 * @param {string[]} categoryNames - An array of available category names.
 * @returns {Promise<object>} A structured query object.
 */
const processBalanceQuery = async (text, accountNames, categoryNames) => {
  try {
    const balanceQueryZodSchema = z.object({
      query_type: z
        .enum(['account', 'budget', 'summary'])
        .describe(
          "The type of query. 'account' for account balances, 'budget' for a specific category's budget, 'summary' for a general budget overview."
        ),
      name: z
        .string()
        .nullable()
        .describe(
          "The name of the account or category. Use 'all' for all accounts or a budget summary. Choose from the provided lists."
        ),
    });

    const balanceQueryJsonSchema = zodToJsonSchema(balanceQueryZodSchema);

    const modelWithSchema = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: balanceQueryJsonSchema,
      },
    });

    const prompt = `You are a financial query processing AI. Extract the query details from the user's message.

Available accounts: ${accountNames.join(', ')}
Available categories: ${categoryNames.join(', ')}

User message: "${text}"`;

    const result = await modelWithSchema.generateContent(prompt);
    const responseJson = JSON.parse(result.response.text());

    const validatedData = balanceQueryZodSchema.parse(responseJson);
    return validatedData;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Gemini response validation error (processBalanceQuery): ${error.message}`
      );
    }
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Gemini API Error (processBalanceQuery): ${error.message}`);
  }
};

/**
 * Gets a general answer from the model.
 * @param {string} text - The user's question.
 * @returns {Promise<object>} An object containing the answer.
 */
const getAnswer = async (text) => {
  try {
    const prompt = `Answer the user's question or general inquiry concisely. User question: "${text}"`;
    const result = await model.generateContent(prompt);
    const { response } = result;
    // We don't need to parse this as JSON because the response is not configured for it.
    // Let's wrap it in the expected format ourselves.
    return { content: response.text() };
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Gemini API Error (getAnswer): ${error.message}`);
  }
};

module.exports = {
  determineIntent,
  processTransaction,
  processBalanceQuery,
  getAnswer,
};
