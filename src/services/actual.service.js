const actual = require('@actual-app/api');
const httpStatus = require('http-status');
const config = require('../config/config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

let isInitialized = false;

/**
 * @typedef {object} Transaction
 * @property {string} date - The transaction date in YYYY-MM-DD format.
 * @property {number} amount - The transaction amount in milliunits (e.g., $12.34 is 12340).
 * @property {string} [payee_name] - The name of the payee.
 * @property {string} [notes] - Any notes for the transaction.
 * @property {string} [category] - The ID of the category for the transaction.
 * @property {boolean} [cleared] - The cleared status of the transaction.
 */

/**
 * @typedef {object} Account
 * @property {string} id - The account's unique identifier.
 * @property {string} name - The name of the account.
 * @property {string} type - The type of the account (e.g., 'checking', 'savings').
 * @property {boolean} offbudget - Whether the account is an off-budget account.
 * @property {boolean} closed - Whether the account is closed.
 * @property {number} balance - The current balance of the account.
 */

/**
 * @typedef {object} Category
 * @property {string} id - The category's unique identifier.
 * @property {string} name - The name of the category.
 * @property {boolean} is_income - Whether this is an income category.
 * @property {string} group_id - The ID of the group this category belongs to.
 */

/**
 * @typedef {object} Payee
 * @property {string} id - The payee's unique identifier.
 * @property {string} name - The name of the payee.
 * @property {string} [transfer_acct] - If this is a transfer payee, the ID of the account it transfers to/from.
 * @property {boolean} [internal] - Whether this is an internal payee (e.g., for transfers).
 */

/**
 * Initializes the connection to the Actual Budget server.
 * This must be called before any other methods.
 * @returns {Promise<void>}
 */
const init = async () => {
  if (isInitialized) {
    return;
  }
  try {
    logger.info('Initializing connection to Actual Budget server...');
    await actual.init({
      dataDir: config.actual.dataDir,
      serverURL: config.actual.serverURL,
      password: config.actual.password,
    });

    await actual.downloadBudget(config.actual.syncId);

    isInitialized = true;
    logger.info('Successfully connected to Actual Budget server.');
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Init Error: ${error.message}`);
  }
};

/**
 * Adds transactions to a specified account in Actual.
 * @param {string} accountId - The ID of the account to add the transaction to.
 * @param {Transaction[]} transactions - An array of transaction objects.
 * @returns {Promise<string[]>} The IDs of the added transactions.
 */
const addTransactions = async (accountId, transactions, runTransfers = false) => {
  if (!isInitialized) {
    await init();
  }

  try {
    logger.info(`Adding ${transactions.length} transaction(s) to account ${accountId}`);
    const transactionIds = await actual.addTransactions(accountId, transactions, runTransfers);
    return transactionIds;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Error (addTransactions): ${error.message}`);
  }
};

/**
 * Gets the budget for a specific month.
 * @param {string} date - The month to get the budget for, in YYYY-MM format.
 * @returns {Promise<object>} The budget data for the specified month.
 */
const getBudgetMonth = async (date) => {
  if (!isInitialized) {
    await init();
  }

  try {
    logger.info(`Getting budget for month: ${date}`);
    const budgetMonth = await actual.getBudgetMonth(date);
    return budgetMonth;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Error (getBudgetMonth): ${error.message}`);
  }
};

/**
 * Gets all accounts.
 * @returns {Promise<Account[]>} A list of all accounts.
 */
const getAccounts = async () => {
  if (!isInitialized) {
    await init();
  }

  try {
    logger.info('Getting all accounts...');
    const accounts = await actual.getAccounts();
    return accounts;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Error (getAccounts): ${error.message}`);
  }
};

/**
 * Gets all categories.
 * @returns {Promise<Category[]>} A list of all categories.
 */
const getCategories = async () => {
  if (!isInitialized) {
    await init();
  }

  try {
    logger.info('Getting all categories...');
    const categories = await actual.getCategories();
    return categories;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Error (getCategories): ${error.message}`);
  }
};

/**
 * Gets all payees.
 * @returns {Promise<Payee[]>} A list of all payees.
 */
const getPayees = async () => {
  if (!isInitialized) {
    await init();
  }

  try {
    logger.info('Getting all payees...');
    const payees = await actual.getPayees();
    return payees;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Error (getPayees): ${error.message}`);
  }
};

/**
 * Gets the balance for a single account.
 * @param {string} accountId - The ID of the account.
 * @returns {Promise<number>} The balance of the account in cents.
 */
const getAccountBalance = async (accountId) => {
  if (!isInitialized) {
    await init();
  }

  try {
    logger.info(`Getting balance for account: ${accountId}`);
    const balance = await actual.getAccountBalance(accountId);
    return balance;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Actual API Error (getAccountBalance): ${error.message}`);
  }
};
/**
 * Shuts down the connection to the Actual Budget server.
 */
const shutdown = async () => {
  await actual.shutdown();
  isInitialized = false;
  logger.info('Connection to Actual Budget server shut down.');
};

module.exports = {
  init,
  addTransactions,
  getBudgetMonth,
  getAccounts,
  getAccountBalance,
  getCategories,
  getPayees,
  shutdown,
};