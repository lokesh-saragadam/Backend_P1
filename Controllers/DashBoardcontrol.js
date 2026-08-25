const { pool , prisma } = require('../database/db');
const asyncHandler = require('express-async-handler');

//Functions
const log = require("../utils/logger");
const { getDashboardData } = require('../services/dashboard');


const getUtils = asyncHandler(async (req, res) => {
    log("DahBoardcontrol.js" ,"getUtils","Request recieved");
    const {id} = req.params;
    const userid = Number(id);
    const data = await prisma.user.findUnique({
        where:{
            userid:userid,
        }
    });
    // console.log("Dashboard data has been paused for now.")
    const result = await getDashboardData(userid);
    if (!result) {
        return res.status(404).json({ error: "result not found" });
    }
    log("DahBoardcontrol.js" ,"getUtils","Request resolved");
    res.status(200).json({ username: data.username, dashboardData: result });
})

module.exports = { getUtils }