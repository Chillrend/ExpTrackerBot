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
      intent: z.enum(['transaction', 'question']).describe('The determined intent of the user input.'),
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
 * @returns {Promise<object>} A structured transaction object.
 */
const processTransaction = async (text) => {
  try {
    // 1. Define the schema for the transaction output using Zod
    const transactionZodSchema = z.object({
      description: z.string().describe('A clear description of the transaction.'),
      amount: z.string().describe("The numeric amount as a string, parsed from formats like '20k' to '20000'."),
      category: z
        .enum(['Food & Drink', 'Transportation', 'Shopping', 'Bills', 'Entertainment', 'Other'])
        .describe('Inferred category for the transaction.'),
      source_account_name: z
        .enum(['Payroll', 'Gopay', 'Cash', 'Other'])
        .nullable()
        .describe(
          "The name of the source account if mentioned (e.g., 'BCA', 'Gopay', 'Cash'), default to 'Other' if not mentioned"
        ),
      message_to_user: z
        .string()
        .describe(
          "A short summary on what you just done, use emojis if necessary."
        ),
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
    const prompt = `You are a financial assistant. Extract transaction details from the following user input, which is in Indonesian:
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
 * Gets a general answer from the model.
 * @param {string} text - The user's question.
 * @returns {Promise<object>} An object containing the answer.
 */
const getAnswer = async (text) => {
  try {
    const prompt = `Answer the user's question or general inquiry, response must not be longer than 2 paraghraps. User question: "${text}"`;
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
  getAnswer,
};
