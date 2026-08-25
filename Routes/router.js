const express = require('express');
const router = express.Router();

const { loginUser, registerUser } = require('../Authentication/Auth');
const { getUsers } = require('../Controllers/Usercontrol')
const { getProblems , postUserData , PostProblemData } = require('../Controllers/Problemcontrol');
const { stats_summary } = require('../Controllers/Statscontrol');
const { authenticate } = require('../Middleware/protectRoutes');
const { getUtils } = require('../Controllers/DashBoardcontrol');
//@Public (Does not need Authorization)
router.route('/register').post(registerUser);
router.route('/login').post(loginUser);

//@Private  (Use JWT Authorization)
router.route('/users/:id').get(authenticate,getUsers).post(authenticate,postUserData);
router.route('/stats/summary').get(authenticate,stats_summary);
router.route('/problems').get(authenticate,getProblems).post( authenticate,postUserData );;
router.route('/dashboard/:id').get(authenticate,getUtils);
router.route('/Leetcode/:id').post(authenticate, PostProblemData);

module.exports = { router };