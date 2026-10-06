const asyncHandler = require('express-async-handler');
const HttpError = require('../utils/httpError');
const { listRecommendations, recordRecommendationEvent } = require('../services/recommendation.service');

const list = asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 5);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new HttpError(400, 'Use a recommendation limit from 1 to 10.', 'INVALID_LIMIT');
    const recommendations = await listRecommendations(req.user.userId, limit);
    res.json({ recommendations });
});

const recordEvent = asyncHandler(async (req, res) => {
    const recommendationId = Number(req.params.recommendationId);
    const event = req.body?.event;
    if (!Number.isSafeInteger(recommendationId) || !['shown', 'opened', 'started', 'dismissed', 'accepted', 'attempted_not_solved'].includes(event)) {
        throw new HttpError(400, 'Use a valid recommendation event.', 'INVALID_RECOMMENDATION_EVENT');
    }
    const recommendation = await recordRecommendationEvent(req.user.userId, recommendationId, event);
    if (!recommendation) throw new HttpError(404, 'Recommendation not found.', 'RECOMMENDATION_NOT_FOUND');
    res.json({ success: true });
});
module.exports = { list, recordEvent };
