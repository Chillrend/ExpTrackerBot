const axios = require('axios');
const httpStatus = require('http-status');
const config = require('../config/config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

const wahaApi = axios.create({
  baseURL: config.waha.baseUrl,
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': config.waha.apiKey,
  },
});

/**
 * Send a text message using WAHA.
 * @param {string} to - The recipient's chat ID (e.g., '1234567890@c.us').
 * @param {string} message - The text message to send.
 * @returns {Promise<void>}
 */
const sendTextMessage = async (to, message) => {
  try {
    logger.info(`Sending message to ${to}: "${message}"`);
    await wahaApi.post('/api/sendText', {
      session: 'default',
      chatId: to,
      text: message,
    });
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `WAHA API Error: ${errorMessage}`);
  }
};

/**
 * Mark a message as seen in a chat.
 * @param {string} chatId - The chat ID to mark as seen (e.g., '1234567890@c.us').
 * @returns {Promise<void>}
 */
const sendSeen = async (chatId) => {
  try {
    logger.info(`Marking chat ${chatId} as seen.`);
    await wahaApi.post('/api/sendSeen', {
      session: 'default',
      chatId,
    });
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    // We can log this as a warning since it's not critical if it fails
    logger.warn(`WAHA API Error (sendSeen): ${errorMessage}`);
  }
};

module.exports = {
  sendTextMessage,
  sendSeen,
};
