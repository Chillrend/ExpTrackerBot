const mongoose = require('mongoose');

const webhookEventSchema = mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically delete documents after 1 day to keep the collection clean
webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);

module.exports = WebhookEvent;
