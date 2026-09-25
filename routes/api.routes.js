const express = require('express');
const router = express.Router();
const { loginUser, registerUser } = require('../auth/auth.controller');
const { getCurrentUser } = require('../controllers/user.controller');
const { listProblems, importLinkedPlatformHistory, importClientSubmissions, importExtensionLeetcodeHistory } = require('../controllers/problem.controller');
const { getCatalogSummary } = require('../controllers/catalogStats.controller');
const { authenticate, requireOwner } = require('../middleware/protectRoutes');
const { getDashboard } = require('../controllers/dashboard.controller');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.use(authenticate);
router.route('/users/:id').all(requireOwner).get(getCurrentUser).post(importLinkedPlatformHistory);
router.get('/stats/summary', getCatalogSummary);
router.route('/problems').get(listProblems).post(requireOwner, importLinkedPlatformHistory);
router.get('/dashboard/:id', requireOwner, getDashboard);
router.post('/Leetcode/:id', requireOwner, importClientSubmissions);
router.post('/imports/leetcode/:id', requireOwner, importExtensionLeetcodeHistory);
module.exports = { router };
