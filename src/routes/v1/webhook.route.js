const express = require('express');
const validate = require('../../middlewares/validate');
const { webhookValidation } = require('../../validations');
const webhookController = require('../../controllers/webhook.controller');

const router = express.Router();

router.post('/', validate(webhookValidation.handleWebhook), webhookController.handleWebhook);

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Webhook
 *   description: Webhook endpoint for incoming events
 */

/**
 * @swagger
 * /webhook:
 *   post:
 *     summary: Handle incoming webhooks
 *     tags: [Webhook]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *               payload:
 *                 type: object
 *             example:
 *               event: "message"
 *               payload: {"from": "sender", "to": "receiver", "body": "Hello!"}
 *     responses:
 *       "200":
 *         description: OK
 */
